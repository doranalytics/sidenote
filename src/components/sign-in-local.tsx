"use client";

// The in-app flavor of sign-in: both steps go to this Mac's own server, which
// relays them to sidenote.lol and keeps the token that comes back.
export { SignInForm } from "@/components/sign-in-form";

async function call(method: "POST" | "PUT", body: unknown) {
  try {
    const res = await fetch("/api/ai/access", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (data.error as string) ?? "Something went wrong.", code: data.code as string | undefined };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Couldn't reach Sidenote. Check your connection." };
  }
}

export const sendCodeLocal = (email: string) => call("POST", { email });
export const verifyCodeLocal = (email: string, code: string) => call("PUT", { email, code });
