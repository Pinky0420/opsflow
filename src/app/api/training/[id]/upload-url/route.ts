import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTrainingUploadTarget } from "@/lib/training/storage";

type UploadUrlBody = {
  file_name: string;
  content_type: string;
  file_size: number;
};

function validateUpload(body: UploadUrlBody) {
  const name = body.file_name.toLowerCase();

  const isVideo = [".mp4", ".mov"].some((ext) => name.endsWith(ext));
  const isImage = [".png", ".jpg", ".jpeg", ".webp"].some((ext) => name.endsWith(ext));
  const isPdf = name.endsWith(".pdf");
  const isOffice = [".docx", ".xlsx", ".pptx"].some((ext) => name.endsWith(ext));
  const isTxt = name.endsWith(".txt");

  if (isVideo && body.file_size > 2 * 1024 * 1024 * 1024) return "video_too_large";
  if (isImage && body.file_size > 10 * 1024 * 1024) return "image_too_large";
  if (isPdf && body.file_size > 50 * 1024 * 1024) return "pdf_too_large";
  if (isOffice && body.file_size > 50 * 1024 * 1024) return "office_too_large";

  if (!(isVideo || isImage || isPdf || isOffice || isTxt)) return "unsupported_file_type";

  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: material } = await supabase
    .from("training_materials")
    .select("id, uploaded_by")
    .eq("id", id)
    .maybeSingle();

  if (!material) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();

  const isAdmin = profile?.role === "admin";
  const isBoss = profile?.role === "boss";
  const isUploader = profile?.role === "uploader";

  if (!(isAdmin || isBoss || (isUploader && material.uploaded_by === user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: UploadUrlBody;
  try {
    body = (await request.json()) as UploadUrlBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.file_name || !body.content_type || typeof body.file_size !== "number") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const validationError = validateUpload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const target = await createTrainingUploadTarget({ materialId: id, fileName: body.file_name });

    return NextResponse.json({
      bucket: target.bucket,
      path: target.objectPath,
      signedUrl: target.signedUrl,
      token: target.token,
    });
  } catch {
    return NextResponse.json({ error: "signed_upload_failed" }, { status: 500 });
  }
}
