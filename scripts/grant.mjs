#!/usr/bin/env node
// Lets someone in without a Stripe purchase — a friend, a tester, a refund
// you reversed by hand. Writes a `manual` purchase row and creates the Auth
// user, so the email can sign in exactly like a buyer.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/grant.mjs someone@example.com
//   …or with the site's env pulled locally:  vercel env pull .env.local && node scripts/grant.mjs …
//
// Pass --revoke to take it back (marks the row refunded; AI stops within ten minutes).
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

if (!process.env.SUPABASE_URL && fs.existsSync(".env.local")) {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [email, flag] = process.argv.slice(2);
if (!url || !key || !email) {
  console.error("usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/grant.mjs <email> [--revoke]");
  process.exit(1);
}
const clean = email.trim().toLowerCase();
const db = createClient(url, key, { auth: { persistSession: false } });

if (flag === "--revoke") {
  const { error } = await db.from("purchases").update({ status: "refunded" }).eq("email", clean);
  if (error) throw error;
  console.log(`revoked ${clean}`);
  process.exit(0);
}

const { error } = await db.from("purchases").insert({
  email: clean,
  source: "manual",
  livemode: true,
  status: "paid",
  amount_cents: 0,
});
if (error) throw error;
const { error: uerr } = await db.auth.admin.createUser({ email: clean, email_confirm: true });
if (uerr && !/already|exists|registered/i.test(uerr.message)) throw uerr;
console.log(`granted ${clean} — they can sign in with that email now`);
