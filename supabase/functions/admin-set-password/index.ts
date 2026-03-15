import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";
import { requireAdminUser } from "../_shared/auth.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

function mapAccessLevelToRole(level: "viewer" | "manager" | "admin") {
  if (level === "admin") return "admin";
  if (level === "manager") return "boss";
  return "employee";
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
    const { user, error: authError } = await requireAdminUser(req);
    if (!user) {
      const status = authError === "forbidden" ? 403 : 401;
      return new Response(JSON.stringify({ error: authError }), { status, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) return new Response(JSON.stringify({ error: "missing_id" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    let body: { password?: string };
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } }); }

    const password = body.password ?? "";
    if (!password || password.length < 8) return new Response(JSON.stringify({ error: "weak_password" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const admin = createSupabaseAdminClient();

    const { data: access, error: accessError } = await admin.from("access_controls").select("email, display_name, access_level, status").eq("id", id).maybeSingle();
    if (accessError) return new Response(JSON.stringify({ error: `access_query_failed:${accessError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    if (!access) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });
    if (access.status !== "active") return new Response(JSON.stringify({ error: "access_disabled" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const email = access.email.toLowerCase();
    const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return new Response(JSON.stringify({ error: `auth_list_failed:${listError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

    const existing = (list.users ?? []).find((u: { email?: string }) => (u.email ?? "").toLowerCase() === email) ?? null;
    let authUserId: string;

    if (existing) {
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { name: access.display_name ?? email } });
      if (updateError || !updated.user) return new Response(JSON.stringify({ error: `auth_update_failed:${updateError?.message ?? "unknown"}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
      authUserId = updated.user.id;
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: access.display_name ?? email } });
      if (createError || !created.user) return new Response(JSON.stringify({ error: `auth_create_failed:${createError?.message ?? "unknown"}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
      authUserId = created.user.id;
    }

    const role = mapAccessLevelToRole(access.access_level);
    const { error: upsertError } = await admin.from("profiles").upsert({ id: authUserId, account_id: email, display_name: access.display_name ?? email, role, status: "active", password_set: true });

    if (upsertError) {
      if (isMissingPasswordSetColumn(upsertError.message)) {
        const { error: fallbackError } = await admin.from("profiles").upsert({ id: authUserId, account_id: email, display_name: access.display_name ?? email, role, status: "active" });
        if (fallbackError) return new Response(JSON.stringify({ error: `profile_upsert_failed:${fallbackError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ ok: true, warning: "missing_password_set_column" }), { headers: { ...headers, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `profile_upsert_failed:${upsertError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
