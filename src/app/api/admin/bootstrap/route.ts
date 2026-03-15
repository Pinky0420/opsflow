import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  email?: string;
  password?: string;
  display_name?: string | null;
  secret?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isMissingPasswordSetColumn(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    normalized.includes("password_set") &&
    (normalized.includes("could not find") || normalized.includes("schema cache") || normalized.includes("column"))
  );
}

export async function POST(request: Request) {
  const expected = process.env.BOOTSTRAP_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "missing_bootstrap_secret" }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const supplied = request.headers.get("x-bootstrap-secret") ?? body.secret ?? "";
  if (supplied !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const email = normalizeEmail(body.email ?? "");
  const password = body.password ?? "";
  const displayName = body.display_name?.trim() || null;

  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });
  if (!password || password.length < 8) return NextResponse.json({ error: "weak_password" }, { status: 400 });

  const admin = createSupabaseAdminClient();

  // Ensure allowlist entry exists as Admin.
  const { error: allowError } = await admin
    .from("access_controls")
    .upsert(
      {
        email,
        display_name: displayName ?? email,
        access_level: "admin",
        status: "active",
      },
      { onConflict: "email" }
    );

  if (allowError) {
    return NextResponse.json({ error: `allowlist_upsert_failed:${allowError.message}` }, { status: 500 });
  }

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
        name: displayName ?? email,
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
        name: displayName ?? email,
      },
    });

    if (createError || !created.user) {
      return NextResponse.json({ error: `auth_create_failed:${createError?.message ?? "unknown"}` }, { status: 500 });
    }

    authUserId = created.user.id;
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: authUserId,
    account_id: email,
    display_name: displayName ?? email,
    role: "admin",
    status: "active",
    password_set: true,
  });

  if (profileError) {
    if (isMissingPasswordSetColumn(profileError.message)) {
      const { error: fallbackError } = await admin.from("profiles").upsert({
        id: authUserId,
        account_id: email,
        display_name: displayName ?? email,
        role: "admin",
        status: "active",
      });

      if (fallbackError) {
        return NextResponse.json({ error: `profile_upsert_failed:${fallbackError.message}` }, { status: 500 });
      }

      return NextResponse.json({ ok: true, email, warning: "missing_password_set_column" });
    }

    return NextResponse.json({ error: `profile_upsert_failed:${profileError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email });
}
