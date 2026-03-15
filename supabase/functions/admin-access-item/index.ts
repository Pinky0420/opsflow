import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";
import { requireAdminUser } from "../_shared/auth.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

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

    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) return new Response(JSON.stringify({ error: "missing_id" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const admin = createSupabaseAdminClient();

    if (req.method === "PATCH") {
      let body: { display_name?: string | null; access_level?: string; status?: string };
      try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } }); }

      const patch: Record<string, string | null> = {};
      if (body.display_name !== undefined) patch.display_name = body.display_name?.trim() || null;
      if (body.access_level !== undefined) patch.access_level = body.access_level;
      if (body.status !== undefined) patch.status = body.status;

      const { data: item, error } = await admin.from("access_controls").update(patch).eq("id", id).select("id, email, display_name, access_level, status, created_at, updated_at").single();
      if (error || !item) return new Response(JSON.stringify({ error: "update_failed" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

      if (patch.display_name !== undefined) {
        await admin.from("profiles").update({ display_name: patch.display_name }).eq("account_id", item.email);
      }

      const { data: profile } = await admin.from("profiles").select("account_id, display_name, role, status").eq("account_id", item.email).maybeSingle();
      return new Response(JSON.stringify({ item: { ...item, profile: profile ?? null } }), { headers: { ...headers, "Content-Type": "application/json" } });
    }

    if (req.method === "DELETE") {
      const { error } = await admin.from("access_controls").delete().eq("id", id);
      if (error) return new Response(JSON.stringify({ error: `delete_failed:${error.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
