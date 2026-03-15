import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "boss" && profile.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: reply } = await supabase
    .from("replies")
    .select("id, audio_bucket, audio_path")
    .eq("id", id)
    .maybeSingle();

  if (!reply) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: signed, error } = await admin.storage
    .from(reply.audio_bucket)
    .createSignedUploadUrl(reply.audio_path);

  if (error || !signed) {
    return NextResponse.json({ error: "signed_upload_failed" }, { status: 500 });
  }

  return NextResponse.json({
    path: reply.audio_path,
    signedUrl: signed.signedUrl,
    token: signed.token,
  });
}
