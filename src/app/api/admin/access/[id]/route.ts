import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type UpdateAccessBody = {
  display_name?: string | null;
  access_level?: "viewer" | "manager" | "admin";
  status?: "active" | "disabled";
};

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "admin") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { supabase, user };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;

  let body: UpdateAccessBody;
  try {
    body = (await request.json()) as UpdateAccessBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, string | null> = {};
  if (body.display_name !== undefined) patch.display_name = body.display_name?.trim() || null;
  if (body.access_level !== undefined) patch.access_level = body.access_level;
  if (body.status !== undefined) patch.status = body.status;

  const admin = createSupabaseAdminClient();
  const { data: item, error } = await admin
    .from("access_controls")
    .update(patch)
    .eq("id", id)
    .select("id, email, display_name, access_level, status, created_at, updated_at")
    .single();

  if (error || !item) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  if (patch.display_name !== undefined) {
    await admin
      .from("profiles")
      .update({ display_name: patch.display_name })
      .eq("account_id", item.email);
  }

  const { data: profile } = await admin.from("profiles").select("account_id, display_name, role, status").eq("account_id", item.email).maybeSingle();
  return NextResponse.json({ item: { ...item, profile: profile ?? null } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("access_controls").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: `delete_failed:${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
