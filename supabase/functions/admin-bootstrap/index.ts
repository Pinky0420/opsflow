import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isMissingPasswordSetColumn(message: string) {
  const n = message.toLowerCase().replace(/\s+/g, " ").trim();
  return n.includes("password_set") && (n.includes("could not find") || n.includes("schema cache") || n.includes("column"));
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    const expected = Deno.env.get("BOOTSTRAP_SECRET") ?? "";
    if (!expected) return new Response(JSON.stringify({ error: "missing_bootstrap_secret" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

    let body: { email?: string; password?: string; display_name?: string | null; secret?: string };
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } }); }

    const supplied = req.headers.get("x-bootstrap-secret") ?? body.secret ?? "";
    if (supplied !== expected) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });

    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";
    const displayName = body.display_name?.trim() || null;

    if (!email) return new Response(JSON.stringify({ error: "missing_email" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    if (!password || password.length < 8) return new Response(JSON.stringify({ error: "weak_password" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const admin = createSupabaseAdminClient();

    const { error: allowError } = await admin.from("access_controls").upsert({ email, display_name: displayName ?? email, access_level: "admin", status: "active" }, { onConflict: "email" });
    if (allowError) return new Response(JSON.stringify({ error: `allowlist_upsert_failed:${allowError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

    const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return new Response(JSON.stringify({ error: `auth_list_failed:${listError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

    const existing = (list.users ?? []).find((u: { email?: string }) => (u.email ?? "").toLowerCase() === email) ?? null;
    let authUserId: string;

    if (existing) {
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { name: displayName ?? email } });
      if (updateError || !updated.user) return new Response(JSON.stringify({ error: `auth_update_failed:${updateError?.message ?? "unknown"}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
      authUserId = updated.user.id;
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: displayName ?? email } });
      if (createError || !created.user) return new Response(JSON.stringify({ error: `auth_create_failed:${createError?.message ?? "unknown"}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
      authUserId = created.user.id;
    }

    const { error: profileError } = await admin.from("profiles").upsert({ id: authUserId, account_id: email, display_name: displayName ?? email, role: "admin", status: "active", password_set: true });

    if (profileError) {
      if (isMissingPasswordSetColumn(profileError.message)) {
        const { error: fallbackError } = await admin.from("profiles").upsert({ id: authUserId, account_id: email, display_name: displayName ?? email, role: "admin", status: "active" });
        if (fallbackError) return new Response(JSON.stringify({ error: `profile_upsert_failed:${fallbackError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ ok: true, email, warning: "missing_password_set_column" }), { headers: { ...headers, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `profile_upsert_failed:${profileError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, email }), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
