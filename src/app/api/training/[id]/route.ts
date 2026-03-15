import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type UpdateTrainingBody = {
  title: string;
  description?: string;
  content_type: "video" | "image" | "pdf" | "text" | "office" | "other";
  visibility: "all" | "department";
  keywords?: string;
  department_ids?: string[];
};

async function requireManager() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }), supabase, user: null, role: null } as const;
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = profile?.role ?? null;

  if (role !== "admin" && role !== "boss") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }), supabase, user, role } as const;
  }

  return { error: null, supabase, user, role } as const;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireManager();
  if (ctx.error) return ctx.error;

  let body: UpdateTrainingBody;
  try {
    body = (await request.json()) as UpdateTrainingBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.title || !body.content_type || !body.visibility) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const departmentIds = Array.isArray(body.department_ids) ? body.department_ids : [];
  if (body.visibility === "department" && departmentIds.length === 0) {
    return NextResponse.json({ error: "missing_departments" }, { status: 400 });
  }

  const { error: updateError } = await ctx.supabase
    .from("training_materials")
    .update({
      title: body.title,
      description: body.description ?? null,
      content_type: body.content_type,
      visibility: body.visibility,
      keywords: body.keywords ?? "",
      updated_by: ctx.user.id,
    })
    .eq("id", id)
    .eq("status", "active");

  if (updateError) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const { error: deleteDepsError } = await ctx.supabase
    .from("training_material_departments")
    .delete()
    .eq("material_id", id);

  if (deleteDepsError) {
    return NextResponse.json({ error: "update_departments_failed" }, { status: 500 });
  }

  if (body.visibility === "department" && departmentIds.length > 0) {
    const rows = departmentIds.map((department_id) => ({ material_id: id, department_id }));
    const { error: insertDepsError } = await ctx.supabase.from("training_material_departments").insert(rows);
    if (insertDepsError) {
      return NextResponse.json({ error: "update_departments_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireManager();
  if (ctx.error) return ctx.error;

  const { error } = await ctx.supabase
    .from("training_materials")
    .update({ status: "deleted", updated_by: ctx.user.id })
    .eq("id", id)
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
