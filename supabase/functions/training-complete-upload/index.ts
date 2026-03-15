import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient, createSupabaseUserClient } from "../_shared/supabase.ts";
import { getBearerToken } from "../_shared/auth.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    const token = getBearerToken(req);
    if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    const userClient = createSupabaseUserClient(token);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    let body: { material_id?: string; file_path?: string; file_name?: string; file_size?: number; mime_type?: string };
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const { material_id, file_path, file_name, file_size, mime_type } = body;
    if (!material_id || !file_path || !file_name) {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const admin = createSupabaseAdminClient();

    const { data: material } = await admin
      .from("training_materials")
      .select("id, uploaded_by")
      .eq("id", material_id)
      .maybeSingle();

    if (!material) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? null;
    const isAdminOrBoss = role === "admin" || role === "boss";
    const isUploader = role === "uploader";
    const isOwner = (material as { uploaded_by?: string }).uploaded_by === user.id;

    if (!isAdminOrBoss && !(isUploader && isOwner)) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const { error: updateError } = await admin
      .from("training_materials")
      .update({
        file_bucket: "training-files",
        file_path,
        file_name,
        file_size: typeof file_size === "number" ? file_size : null,
        mime_type: mime_type ?? null,
        updated_by: user.id,
      })
      .eq("id", material_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message || "update_failed" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, material_id }), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
