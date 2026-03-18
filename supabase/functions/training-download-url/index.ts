import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient, createSupabaseUserClient } from "../_shared/supabase.ts";
import { getBearerToken } from "../_shared/auth.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    const token = getBearerToken(req);
    if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    const userClient = createSupabaseUserClient(token);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    const url = new URL(req.url);
    const id = url.searchParams.get("id") ?? "";
    if (!id) return new Response(JSON.stringify({ error: "missing_id" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const admin = createSupabaseAdminClient();

    const { data: material } = await admin.from("training_materials").select("id, visibility, status, file_bucket, file_path").eq("id", id).maybeSingle();
    if (!material || material.status !== "active") return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });
    if (!material.file_bucket || !material.file_path) return new Response(JSON.stringify({ error: "no_file" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const isAdminOrBoss = profile?.role === "admin" || profile?.role === "boss";

    if (!isAdminOrBoss && material.visibility === "department") {
      const { data: userDepts } = await admin.from("user_departments").select("department_id").eq("user_id", user.id);
      const userDeptIds = new Set((userDepts ?? []).map((r: { department_id: string }) => r.department_id));
      const { data: materialDepts } = await admin.from("training_material_departments").select("department_id").eq("material_id", id);
      const ok = (materialDepts ?? []).some((r: { department_id: string }) => userDeptIds.has(r.department_id));
      if (!ok) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
    }

    if (material.file_bucket === "google-drive") {
      const fileId = material.file_path;
      const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;
      const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      return new Response(JSON.stringify({ signedUrl: viewUrl, downloadUrl }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await admin.storage.from(material.file_bucket).createSignedUrl(material.file_path, 60);
    if (error || !data) {
      return new Response(JSON.stringify({ error: error?.message || "signed_download_failed" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ signedUrl: data.signedUrl }), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
