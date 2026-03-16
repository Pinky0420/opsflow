import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient, createSupabaseUserClient } from "../_shared/supabase.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 200);
}

function validateUpload(fileName: string, fileSize: number): string | null {
  const name = fileName.toLowerCase();
  const isVideo = [".mp4", ".mov"].some((ext) => name.endsWith(ext));
  const isImage = [".png", ".jpg", ".jpeg", ".webp"].some((ext) => name.endsWith(ext));
  const isPdf = name.endsWith(".pdf");
  const isOffice = [".docx", ".xlsx", ".pptx"].some((ext) => name.endsWith(ext));
  const isTxt = name.endsWith(".txt");

  if (isVideo && fileSize > 2 * 1024 * 1024 * 1024) return "video_too_large";
  if (isImage && fileSize > 10 * 1024 * 1024) return "image_too_large";
  if (isPdf && fileSize > 50 * 1024 * 1024) return "pdf_too_large";
  if (isOffice && fileSize > 50 * 1024 * 1024) return "office_too_large";
  if (!(isVideo || isImage || isPdf || isOffice || isTxt)) return "unsupported_file_type";
  return null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const url = new URL(req.url);
  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

  let body: { id?: string; file_name?: string; content_type?: string; file_size?: number };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } }); }

  const id = body.id ?? url.searchParams.get("id") ?? "";
  if (!id) return new Response(JSON.stringify({ error: "missing_id" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

  try {
    const userClient = createSupabaseUserClient(token);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? null;

    const { data: material } = await userClient.from("training_materials").select("id, uploaded_by").eq("id", id).maybeSingle();
    if (!material) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...headers, "Content-Type": "application/json" } });

    const isAdmin = role === "admin";
    const isBoss = role === "boss";
    const isUploader = role === "uploader";
    if (!(isAdmin || isBoss || (isUploader && (material as { uploaded_by?: string }).uploaded_by === user.id))) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
    }

    if (!body.file_name || typeof body.file_size !== "number") {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const validationError = validateUpload(body.file_name, body.file_size);
    if (validationError) return new Response(JSON.stringify({ error: validationError }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });

    const admin = createSupabaseAdminClient();
    const objectPath = `${id}/${Date.now()}_${sanitizeFileName(body.file_name)}`;
    const { data: signed, error: signedError } = await admin.storage.from("training-files").createSignedUploadUrl(objectPath);
    if (signedError || !signed) return new Response(JSON.stringify({ error: "signed_upload_failed" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

    const { error: updateError } = await admin
      .from("training_materials")
      .update({
        file_bucket: "training-files",
        file_path: objectPath,
        file_name: body.file_name,
        file_size: body.file_size,
        mime_type: body.content_type || null,
        updated_by: user.id,
      })
      .eq("id", id);
    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message || "update_failed" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ bucket: "training-files", path: objectPath, signedUrl: signed.signedUrl, token: signed.token }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown_error" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
