import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Who is allowed to download Sidenote and use its AI, and how that is proved.
//
// Two things are sold: the app ($39, once) and AI ($10/month). Both are rows
// in Supabase's `purchases` table — `kind: app` from a one-time Checkout,
// `kind: ai` tracking a Stripe subscription — written by the Stripe webhook,
// or by scripts/grant.mjs for someone you're letting in by hand. An account
// is a Supabase Auth user that signs in with a 6-digit emailed code — inside
// the app to turn AI on, or on sidenote.lol/download to fetch the build again.
// Owning the app is what makes an account; the subscription is what turns AI
// on for it.
//
// Two kinds of signed tokens come out of this file, both HMAC'd with
// SIDENOTE_SIGNING_SECRET so nothing needs to be stored to verify them:
//
//   install token  — `v2.<installId>.<userId>.<sig>`. Lives in the app's
//                    vault after sign-in; sent with every AI relay call and
//                    every update download. `v1.<installId>.<code>.<sig>` is
//                    the pre-paywall invite-code form and still verifies, so
//                    nobody's existing install stops working.
//   download token — `d1.<exp>.<email>.<via>.<sig>`. Short-lived; the thanks
//                    page and the sign-in page mint one, /api/download honors
//                    it.
//
// The one thing the signature can't tell you is whether the purchase or the
// subscription is still good (a refund, a lapsed card), so the relay and the
// release endpoint also ask the database — cached, so it's one query every
// few minutes per person rather than one per message.

const secret = () => process.env.SIDENOTE_SIGNING_SECRET ?? "";

function hmac(body: string): string {
  return crypto.createHmac("sha256", secret()).update(body).digest("hex").slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export const configured = () => !!secret();

/** Live keys mean live purchases; a test-mode deploy only honors test ones. */
export const LIVEMODE = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");

// ---------- install tokens ----------

export type Install =
  | { kind: "invite"; installId: string; code: string }
  | { kind: "account"; installId: string; userId: string };

const inviteCodes = () =>
  (process.env.SIDENOTE_INVITE_CODES ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

/** Legacy: the pre-paywall invite-code token. Kept so old installs work. */
export function signInvite(installId: string, code: string): string {
  const body = `${installId}.${code}`;
  return `v1.${body}.${hmac(body)}`;
}

export function signAccount(installId: string, userId: string): string {
  const body = `${installId}.${userId}`;
  return `v2.${body}.${hmac(body)}`;
}

export function newInstallId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** Verifies an install token's signature. Does NOT check the purchase is
 *  still good — see `installAllowed` for that. */
export function verifyInstall(token: string | null | undefined): Install | null {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [v, installId, subject, sig] = parts;
  if (!installId || !subject || !sig) return null;
  if (!safeEqual(sig, hmac(`${installId}.${subject}`))) return null;
  if (v === "v1") {
    // A code removed from the env list stops working everywhere it was used.
    if (!inviteCodes().includes(subject)) return null;
    return { kind: "invite", installId, code: subject };
  }
  if (v === "v2") return { kind: "account", installId, userId: subject };
  return null;
}

/** A label for metering: which code, or which account. */
export function installLabel(i: Install): string {
  return i.kind === "invite" ? i.code : `user:${i.userId}`;
}

// ---------- download tokens ----------

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export type DownloadGrant = { email: string; via: string; exp: number };

export function signDownload(email: string, via: string, ttlMs = 24 * 60 * 60_000): string {
  const exp = Date.now() + ttlMs;
  const body = `${exp}.${b64(email.toLowerCase())}.${via}`;
  return `d1.${body}.${hmac(body)}`;
}

export function verifyDownload(token: string | null | undefined): DownloadGrant | null {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "d1") return null;
  const [, exp, email, via, sig] = parts;
  if (!safeEqual(sig, hmac(`${exp}.${email}.${via}`))) return null;
  if (Number(exp) < Date.now()) return null;
  try {
    return { email: unb64(email), via, exp: Number(exp) };
  } catch {
    return null;
  }
}

// ---------- Supabase ----------

let admin: SupabaseClient | null = null;
let anon: SupabaseClient | null = null;

const url = () => process.env.SUPABASE_URL ?? "";

/** Service role: reads and writes purchases, creates users. Server only. */
export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url() || !key) throw new Error("Supabase isn't configured.");
  admin = createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Anon key: only ever used for Auth (send a code, verify a code). */
export function supabaseAuth(): SupabaseClient {
  if (anon) return anon;
  const key = process.env.SUPABASE_ANON_KEY ?? "";
  if (!url() || !key) throw new Error("Supabase isn't configured.");
  anon = createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  return anon;
}

export const supabaseConfigured = () =>
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SUPABASE_ANON_KEY;

// ---------- purchases & subscriptions ----------

export type Purchase = {
  id: string;
  email: string;
  user_id: string | null;
  kind: "app" | "ai";
  status: string;
  livemode: boolean;
  source: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
};

const COLS =
  "id,email,user_id,kind,status,livemode,source,stripe_customer_id,stripe_subscription_id,current_period_end";

/** Subscription statuses that still mean "AI is on". past_due rides through
 *  Stripe's retry window rather than cutting someone off over a card hiccup;
 *  canceled/unpaid is the cut-off. */
const AI_ACTIVE = new Set(["active", "trialing", "past_due"]);

export type Entitlement = {
  email: string;
  /** Owns the app: can download and update. */
  app: boolean;
  /** AI is on: has a live subscription (or a manual grant). */
  ai: boolean;
  aiStatus: string | null;
  /** When the current AI period ends (renews or lapses), if known. */
  aiPeriodEnd: string | null;
  stripeCustomerId: string | null;
};

async function rowsFor(email: string): Promise<Purchase[]> {
  const { data } = await supabaseAdmin()
    .from("purchases")
    .select(COLS)
    .eq("email", email.trim().toLowerCase())
    .eq("livemode", LIVEMODE)
    .order("created_at", { ascending: false });
  return (data as Purchase[] | null) ?? [];
}

/** Everything this email is entitled to, in one shape. */
export async function entitlementFor(email: string): Promise<Entitlement> {
  const rows = await rowsFor(email);
  const app = rows.some((r) => r.kind === "app" && r.status === "paid");
  const aiRows = rows.filter((r) => r.kind === "ai");
  const live = aiRows.find((r) => AI_ACTIVE.has(r.status)) ?? null;
  const latest = live ?? aiRows[0] ?? null;
  return {
    email: email.trim().toLowerCase(),
    app,
    ai: !!live,
    aiStatus: latest?.status ?? null,
    aiPeriodEnd: live?.current_period_end ?? null,
    stripeCustomerId: rows.find((r) => r.stripe_customer_id)?.stripe_customer_id ?? null,
  };
}

/** An account exists for anyone who owns the app. */
export async function ownsApp(email: string): Promise<boolean> {
  return (await entitlementFor(email)).app;
}

/** The email behind an Auth user id. */
export async function emailForUser(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
  return data.user?.email?.toLowerCase() ?? null;
}

/** Records a one-time app purchase. Idempotent on the Checkout Session id, so
 *  the webhook and the thanks page can both call it in either order. */
export async function recordAppPurchase(p: {
  email: string;
  sessionId: string;
  customerId: string | null;
  paymentIntentId: string | null;
  amountCents: number;
  currency: string;
  livemode: boolean;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("purchases")
    .upsert(
      {
        email: p.email.trim().toLowerCase(),
        kind: "app",
        source: "stripe",
        livemode: p.livemode,
        status: "paid",
        stripe_customer_id: p.customerId,
        stripe_checkout_session_id: p.sessionId,
        stripe_payment_intent_id: p.paymentIntentId,
        amount_cents: p.amountCents,
        currency: p.currency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(`purchases upsert: ${error.message}`);
  await ensureUser(p.email);
}

/** Mirrors a Stripe subscription's state. Called on create, every update,
 *  and delete, so the row always says what Stripe says. */
export async function recordAiSubscription(p: {
  email: string;
  subscriptionId: string;
  customerId: string | null;
  status: string;
  periodEnd: number | null; // unix seconds
  amountCents: number;
  currency: string;
  livemode: boolean;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("purchases")
    .upsert(
      {
        email: p.email.trim().toLowerCase(),
        kind: "ai",
        source: "stripe",
        livemode: p.livemode,
        status: p.status,
        stripe_customer_id: p.customerId,
        stripe_subscription_id: p.subscriptionId,
        current_period_end: p.periodEnd ? new Date(p.periodEnd * 1000).toISOString() : null,
        amount_cents: p.amountCents,
        currency: p.currency,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    );
  if (error) throw new Error(`subscription upsert: ${error.message}`);
  await ensureUser(p.email);
  verdicts.delete(p.email.trim().toLowerCase());
}

/** Makes sure an Auth user exists for this email so a sign-in code can be
 *  sent to it. Already existing is fine. */
export async function ensureUser(email: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.createUser({
    email: email.trim().toLowerCase(),
    email_confirm: true,
  });
  if (error && !/already|exists|registered/i.test(error.message)) {
    throw new Error(`createUser: ${error.message}`);
  }
}

export async function markRefunded(paymentIntentId: string): Promise<void> {
  await supabaseAdmin()
    .from("purchases")
    .update({ status: "refunded", updated_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", paymentIntentId);
}

/** Ties every row for this email to the Auth user the first time they sign in. */
export async function attachUser(email: string, userId: string): Promise<void> {
  await supabaseAdmin()
    .from("purchases")
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .eq("email", email.trim().toLowerCase())
    .is("user_id", null);
}

export async function logDownload(email: string | null, file: string, via: string): Promise<void> {
  try {
    await supabaseAdmin().from("downloads").insert({ email, file, via });
  } catch {
    // a missing log line must never block a download
  }
}

// ---------- installs (the device cap) ----------

/** How many Macs one purchase may have unlocked at once. */
const INSTALL_LIMIT = Number(process.env.SIDENOTE_INSTALL_LIMIT ?? 3);

/** Registers a fresh activation. If the license is already at the cap, the
 *  least-recently-seen Mac is revoked to make room — the honest owner with a
 *  new laptop just works; a shared license becomes musical chairs. */
export async function registerInstall(
  installId: string,
  email: string,
  userId: string
): Promise<void> {
  const db = supabaseAdmin();
  const clean = email.trim().toLowerCase();
  const { data } = await db
    .from("installs")
    .select("install_id,last_seen")
    .eq("email", clean)
    .eq("revoked", false)
    .order("last_seen", { ascending: true });
  const active = data ?? [];
  const over = active.length - INSTALL_LIMIT + 1;
  if (over > 0) {
    const bump = active.slice(0, over).map((r) => r.install_id);
    await db
      .from("installs")
      .update({ revoked: true })
      .in("install_id", bump);
    for (const id of bump) installVerdicts.delete(id);
  }
  await db.from("installs").insert({ install_id: installId, email: clean, user_id: userId });
}

type InstallRow = { install_id: string; revoked: boolean };

/** Whether this install is still one of the licensed Macs. Rows are created
 *  at activation; a token from before the cap existed gets a row on first
 *  sight (grandfathered) — but a revoked row stays revoked. Cached alongside
 *  the entitlement so it's one query every few minutes, not one per message. */
async function installActive(i: Install): Promise<boolean> {
  if (i.kind === "invite") return true;
  const db = supabaseAdmin();
  const { data } = await db
    .from("installs")
    .select("install_id,revoked")
    .eq("install_id", i.installId)
    .maybeSingle();
  const row = data as InstallRow | null;
  if (row) {
    if (row.revoked) return false;
    void db
      .from("installs")
      .update({ last_seen: new Date().toISOString() })
      .eq("install_id", i.installId)
      .then(() => {});
    return true;
  }
  // Pre-cap token: adopt it so it starts counting like everyone else.
  const email = await emailForUser(i.userId);
  if (!email) return false;
  try {
    await registerInstall(i.installId, email, i.userId);
  } catch {
    // a racing double-insert is fine — the row exists either way
  }
  return true;
}

// ---------- "what is this install allowed to do?" ----------

// Invite tokens are allowed everything by virtue of verifying (the code list
// is the revocation). Account tokens are resolved to an email and checked
// against the table, with the answer remembered for three minutes so a refund
// or a lapsed subscription takes effect almost at once and a chatty session
// doesn't hit the database on every message.
const TTL = 3 * 60_000;
const verdicts = new Map<string, { e: Entitlement; at: number }>();
const userEmails = new Map<string, string>();
export const installVerdicts = new Map<string, { ok: boolean; at: number }>();

const OPEN: Entitlement = {
  email: "",
  app: true,
  ai: true,
  aiStatus: "invite",
  aiPeriodEnd: null,
  stripeCustomerId: null,
};

const LOCKED: Entitlement = {
  email: "",
  app: false,
  ai: false,
  aiStatus: "revoked",
  aiPeriodEnd: null,
  stripeCustomerId: null,
};

export async function entitlementForInstall(i: Install, fresh = false): Promise<Entitlement> {
  if (i.kind === "invite") return OPEN;
  try {
    // Device cap first: a bumped Mac is out regardless of the purchase.
    const iv = installVerdicts.get(i.installId);
    let ok: boolean;
    if (!fresh && iv && Date.now() - iv.at < TTL) {
      ok = iv.ok;
    } else {
      ok = await installActive(i);
      if (installVerdicts.size > 5000) installVerdicts.clear();
      installVerdicts.set(i.installId, { ok, at: Date.now() });
    }
    if (!ok) return LOCKED;
    let email = userEmails.get(i.userId);
    if (!email) {
      email = (await emailForUser(i.userId)) ?? undefined;
      if (!email) return { ...OPEN, app: false, ai: false, aiStatus: null };
      userEmails.set(i.userId, email);
    }
    const hit = verdicts.get(email);
    if (!fresh && hit && Date.now() - hit.at < TTL) return hit.e;
    const e = await entitlementFor(email);
    if (verdicts.size > 5000) verdicts.clear();
    verdicts.set(email, { e, at: Date.now() });
    return e;
  } catch {
    // Database unreachable: a signed token from a real sign-in is the next
    // best evidence. Don't lock paying users out because of our outage.
    return OPEN;
  }
}

/** Forget a cached verdict (after a webhook changes it). */
export function forgetVerdict(email: string) {
  verdicts.delete(email.trim().toLowerCase());
}

/** Can this install download builds? (Owns the app.) */
export async function installOwnsApp(i: Install): Promise<boolean> {
  return (await entitlementForInstall(i)).app;
}

/** Can this install use AI? (Subscription is live.) */
export async function installHasAi(i: Install): Promise<boolean> {
  return (await entitlementForInstall(i)).ai;
}

/** Reads the install token from a request: header first, then ?t= (the
 *  updater's fetch follows redirects with headers; a browser link can't). */
export function installFrom(req: Request): Install | null {
  const header = req.headers.get("x-sidenote-install");
  if (header) return verifyInstall(header);
  try {
    return verifyInstall(new URL(req.url).searchParams.get("t"));
  } catch {
    return null;
  }
}

// ---------- release store ----------

const RELEASE_FILES = new Set(["Sidenote.dmg", "Sidenote.zip"]);

/** A 60-second signed URL for a file in the private `releases` bucket. */
export async function releaseUrl(file: string): Promise<string | null> {
  if (!RELEASE_FILES.has(file)) return null;
  const { data, error } = await supabaseAdmin()
    .storage.from("releases")
    .createSignedUrl(file, 60, { download: file });
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
