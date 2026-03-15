import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function mapAccessLevelToRole(level: "viewer" | "manager" | "admin") {
  if (level === "admin") return "admin";
  if (level === "manager") return "boss";
  return "employee";
}

function isMissingPasswordSetColumn(message: string) {
  const n = message.toLowerCase().replace(/\s+/g, " ").trim();
  return n.includes("password_set") && (n.includes("could not find") || n.includes("schema cache") || n.includes("column"));
}

function isEmailRateLimited(message: string) {
  const m = message.toLowerCase();
  return m.includes("rate limit") || m.includes("too many") || m.includes("over_email_send_rate_limit");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    let body: { email?: string; redirect?: string };
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } }); }

    const email = normalizeEmail(body.email ?? "");
    if (!email) return new Response(JSON.stringify({ error: "missing_email" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const redirectPath = body.redirect && body.redirect.startsWith("/") ? body.redirect : "/training";
    const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const redirectBase = siteUrl || new URL(req.url).origin;
    const admin = createSupabaseAdminClient();

    const { data: access, error: accessError } = await admin.from("access_controls").select("email, display_name, access_level, status").eq("email", email).maybeSingle();
    if (accessError) return new Response(JSON.stringify({ error: `access_query_failed:${accessError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    if (!access || access.status !== "active") return new Response(JSON.stringify({ error: "email_not_allowed" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });

    const role = mapAccessLevelToRole(access.access_level);

    if (access.access_level !== "viewer") {
      const { data: profile, error: profileError } = await admin.from("profiles").select("password_set").eq("account_id", email).maybeSingle();
      if (profileError && !isMissingPasswordSetColumn(profileError.message)) {
        return new Response(JSON.stringify({ error: `profile_query_failed:${profileError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
      }
      if (profile?.password_set) return new Response(JSON.stringify({ error: "password_required" }), { status: 409, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const redirectTo = `${redirectBase}/auth/finish?next=${encodeURIComponent(redirectPath)}`;
    const { error } = await admin.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, data: { invited: true, role, name: access.display_name ?? email } } });

    if (error) {
      if (isEmailRateLimited(error.message)) return new Response(JSON.stringify({ error: "email_rate_limited" }), { status: 429, headers: { ...headers, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `send_link_failed:${error.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
