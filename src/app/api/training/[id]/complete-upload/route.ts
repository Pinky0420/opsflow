import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CompleteUploadBody = {
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
};

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

  let body: CompleteUploadBody;
  try {
    body = (await request.json()) as CompleteUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.file_path || !body.file_name || typeof body.file_size !== "number" || !body.mime_type) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const { error } = await supabase
    .from("training_materials")
    .update({
      file_bucket: "training-files",
      file_path: body.file_path,
      file_name: body.file_name,
      file_size: body.file_size,
      mime_type: body.mime_type,
      updated_by: user.id,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
