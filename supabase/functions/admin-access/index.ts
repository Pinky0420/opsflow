import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";
import { requireAdminUser } from "../_shared/auth.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const { user, error: authError } = await requireAdminUser(req);
    if (!user) {
      const status = authError === "forbidden" ? 403 : 401;
      return new Response(JSON.stringify({ error: authError }), { status, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const admin = createSupabaseAdminClient();

    if (req.method === "GET") {
      const { data, error } = await admin.from("access_controls").select("id, email, display_name, access_level, status, created_at, updated_at").order("email", { ascending: true });
      if (error) return new Response(JSON.stringify({ error: `query_failed:${error.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

      const { data: profiles } = await admin.from("profiles").select("account_id, display_name, role, status");
      const profileMap = new Map((profiles ?? []).filter((p) => p.account_id).map((p) => [p.account_id as string, p] as const));
      const items = (data ?? []).map((item) => ({ ...item, profile: profileMap.get(item.email) ?? null }));
      return new Response(JSON.stringify({ items }), { headers: { ...headers, "Content-Type": "application/json" } });
    }

    if (req.method === "POST") {
      let body: { email?: string; display_name?: string | null; access_level?: string };
      try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } }); }

      const email = normalizeEmail(body.email ?? "");
      if (!email) return new Response(JSON.stringify({ error: "missing_email" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

      const accessLevel = body.access_level ?? "viewer";
      const { data: item, error } = await admin.from("access_controls").upsert({ email, display_name: body.display_name?.trim() || null, access_level: accessLevel, status: "active" }, { onConflict: "email" }).select("id, email, display_name, access_level, status, created_at, updated_at").single();

      if (error || !item) return new Response(JSON.stringify({ error: `save_failed:${error?.message ?? "unknown"}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

      const { data: profile } = await admin.from("profiles").select("account_id, display_name, role, status").eq("account_id", email).maybeSingle();
      return new Response(JSON.stringify({ item: { ...item, profile: profile ?? null } }), { headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
