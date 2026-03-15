import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type CreateTrainingBody = {
  title: string;
  description?: string;
  content_type: "video" | "image" | "pdf" | "text" | "office" | "other";
  visibility: "all" | "department";
  keywords?: string;
  department_ids?: string[];
  file_name?: string;
  file_size?: number;
  mime_type?: string;
};

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim();
  const contentType = (url.searchParams.get("content_type") ?? "").trim();
  const visibility = (url.searchParams.get("visibility") ?? "").trim();
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw ?? 50) || 50, 1), 200);

  let query = supabase
    .from("training_materials")
    .select("id, title, description, content_type, visibility, keywords, file_name, file_size, mime_type, status, created_at, updated_at, file_path, uploaded_by, updated_by")
    .eq("status", "active")
    .not("file_path", "is", null)
    .not("file_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (contentType) {
    query = query.eq("content_type", contentType);
  }

  if (visibility) {
    query = query.eq("visibility", visibility);
  }

  if (search) {
    const s = search.replace(/[%_]/g, "\\$&");
    query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%,keywords.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const profileIds = Array.from(new Set((data ?? []).flatMap((item) => [item.uploaded_by, item.updated_by]).filter(Boolean))) as string[];
  const admin = createSupabaseAdminClient();
  const { data: people } = profileIds.length > 0
    ? await admin.from("profiles").select("id, account_id, display_name").in("id", profileIds)
    : { data: [] as { id: string; account_id: string | null; display_name: string | null }[] };

  const peopleById = new Map((people ?? []).map((person) => [person.id, person] as const));
  const items = (data ?? []).map((item) => ({
    ...item,
    uploader: item.uploaded_by ? peopleById.get(item.uploaded_by) ?? null : null,
    editor: item.updated_by ? peopleById.get(item.updated_by) ?? null : null,
  }));

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || (profile.role !== "uploader" && profile.role !== "admin" && profile.role !== "boss")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: CreateTrainingBody;
  try {
    body = (await request.json()) as CreateTrainingBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.title || !body.content_type || !body.visibility) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const departmentIds = Array.isArray(body.department_ids) ? body.department_ids : [];

  const { data: material, error: insertError } = await supabase
    .from("training_materials")
    .insert({
      title: body.title,
      description: body.description ?? null,
      content_type: body.content_type,
      visibility: body.visibility,
      keywords: body.keywords ?? "",
      file_name: body.file_name ?? null,
      file_size: body.file_size ?? null,
      mime_type: body.mime_type ?? null,
      uploaded_by: user.id,
      status: "active",
    })
    .select("id")
    .single();

  if (insertError || !material) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  if (departmentIds.length > 0) {
    const rows = departmentIds.map((department_id) => ({
      material_id: material.id,
      department_id,
    }));

    const { error: depError } = await supabase.from("training_material_departments").insert(rows);
    if (depError) {
      return NextResponse.json({ error: "insert_departments_failed", material_id: material.id }, { status: 500 });
    }
  }

  return NextResponse.json({ id: material.id });
}
