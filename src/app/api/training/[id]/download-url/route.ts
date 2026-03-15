import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createTrainingDownloadUrl } from "@/lib/training/storage";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select("id, visibility, status, file_bucket, file_path")
    .eq("id", id)
    .maybeSingle();

  if (!material || material.status !== "active") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!material.file_bucket || !material.file_path) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdminOrBoss = profile?.role === "admin" || profile?.role === "boss";

  if (!isAdminOrBoss && material.visibility === "department") {
    const { data: allowedDepartments } = await supabase
      .from("user_departments")
      .select("department_id")
      .eq("user_id", user.id);

    const userDeptIds = new Set((allowedDepartments ?? []).map((r) => r.department_id));

    const { data: materialDepartments } = await supabase
      .from("training_material_departments")
      .select("department_id")
      .eq("material_id", id);

    const materialDeptIds = (materialDepartments ?? []).map((r) => r.department_id);
    const ok = materialDeptIds.some((d) => userDeptIds.has(d));

    if (!ok) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  try {
    const signedUrl = await createTrainingDownloadUrl({
      bucket: material.file_bucket,
      objectPath: material.file_path,
      expiresIn: 60,
    });

    return NextResponse.json({ signedUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "signed_download_failed" }, { status: 500 });
  }
}
