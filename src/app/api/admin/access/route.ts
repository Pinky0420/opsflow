import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type CreateAccessBody = {
  email?: string;
  display_name?: string | null;
  access_level?: "viewer" | "manager" | "admin";
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function GET() {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("access_controls")
    .select("id, email, display_name, access_level, status, created_at, updated_at")
    .order("email", { ascending: true });

  if (error) {
    return NextResponse.json({ error: `query_failed:${error.message}` }, { status: 500 });
  }

  const { data: profiles } = await admin.from("profiles").select("account_id, display_name, role, status");
  const profileByAccountId = new Map((profiles ?? []).filter((item) => item.account_id).map((item) => [item.account_id as string, item] as const));

  const items = (data ?? []).map((item) => ({
    ...item,
    profile: profileByAccountId.get(item.email) ?? null,
  }));

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;

  let body: CreateAccessBody;
  try {
    body = (await request.json()) as CreateAccessBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  const accessLevel = body.access_level ?? "viewer";
  if (!email) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: item, error } = await admin
    .from("access_controls")
    .upsert({
      email,
      display_name: body.display_name?.trim() || null,
      access_level: accessLevel,
      status: "active",
    }, { onConflict: "email" })
    .select("id, email, display_name, access_level, status, created_at, updated_at")
    .single();

  if (error || !item) {
    return NextResponse.json({ error: `save_failed:${error?.message ?? "unknown"}` }, { status: 500 });
  }

  const { data: profile } = await admin.from("profiles").select("account_id, display_name, role, status").eq("account_id", email).maybeSingle();
  return NextResponse.json({ item: { ...item, profile: profile ?? null } });
}
