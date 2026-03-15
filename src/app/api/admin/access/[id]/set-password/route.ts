import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  password?: string;
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

function mapAccessLevelToRole(level: "viewer" | "manager" | "admin") {
  if (level === "admin") return "admin";
  if (level === "manager") return "boss";
  return "employee";
}

function isMissingPasswordSetColumn(message: string) {
  return message.includes("Could not find the 'password_set' column") || message.toLowerCase().includes("password_set");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx.error;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const password = body.password ?? "";
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: access, error: accessError } = await admin
    .from("access_controls")
    .select("email, display_name, access_level, status")
    .eq("id", id)
    .maybeSingle();

  if (accessError) {
    return NextResponse.json({ error: `access_query_failed:${accessError.message}` }, { status: 500 });
  }

  if (!access) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (access.status !== "active") {
    return NextResponse.json({ error: "access_disabled" }, { status: 400 });
  }

  const email = access.email.toLowerCase();

  // Find existing auth user by email.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    return NextResponse.json({ error: `auth_list_failed:${listError.message}` }, { status: 500 });
  }

  const existing = (list.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email) ?? null;

  let authUserId: string;
  if (existing) {
    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        name: access.display_name ?? email,
      },
    });

    if (updateError || !updated.user) {
      return NextResponse.json({ error: `auth_update_failed:${updateError?.message ?? "unknown"}` }, { status: 500 });
    }

    authUserId = updated.user.id;
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: access.display_name ?? email,
      },
    });

    if (createError || !created.user) {
      return NextResponse.json({ error: `auth_create_failed:${createError?.message ?? "unknown"}` }, { status: 500 });
    }

    authUserId = created.user.id;
  }

  const role = mapAccessLevelToRole(access.access_level);

  const { error: upsertError } = await admin.from("profiles").upsert({
    id: authUserId,
    account_id: email,
    display_name: access.display_name ?? email,
    role,
    status: "active",
    password_set: true,
  });

  if (upsertError) {
    if (isMissingPasswordSetColumn(upsertError.message)) {
      const { error: fallbackError } = await admin.from("profiles").upsert({
        id: authUserId,
        account_id: email,
        display_name: access.display_name ?? email,
        role,
        status: "active",
      });

      if (fallbackError) {
        return NextResponse.json({ error: `profile_upsert_failed:${fallbackError.message}` }, { status: 500 });
      }

      return NextResponse.json({ ok: true, warning: "missing_password_set_column" });
    }

    return NextResponse.json({ error: `profile_upsert_failed:${upsertError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
