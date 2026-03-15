import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function mapAccessLevelToRole(level: string) {
  if (level === "admin") return "admin";
  if (level === "manager") return "boss";
  return "employee";
}

function isMissingPasswordSetColumn(message: string) {
  return message.includes("Could not find the 'password_set' column") || message.toLowerCase().includes("password_set");
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const email = user.email.toLowerCase();
  const admin = createSupabaseAdminClient();

  const { data: access, error: accessError } = await admin
    .from("access_controls")
    .select("display_name, access_level, status")
    .eq("email", email)
    .maybeSingle();

  if (accessError) {
    return NextResponse.json({ error: `access_query_failed:${accessError.message}` }, { status: 500 });
  }

  if (!access || access.status !== "active") {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "email_not_allowed" }, { status: 403 });
  }

  let existingPasswordSet: boolean | null = null;
  const { data: existingProfile, error: existingProfileError } = await admin
    .from("profiles")
    .select("password_set")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfileError) {
    if (!isMissingPasswordSetColumn(existingProfileError.message)) {
      return NextResponse.json({ error: `profile_query_failed:${existingProfileError.message}` }, { status: 500 });
    }
  } else {
    existingPasswordSet = existingProfile?.password_set ?? null;
  }

  const baseRow = {
    id: user.id,
    account_id: email,
    display_name: access.display_name ?? (user.user_metadata?.name as string | undefined) ?? email,
    role: mapAccessLevelToRole(access.access_level),
    status: "active",
  };

  const { error: upsertError } = await admin.from("profiles").upsert(
    existingPasswordSet === null ? baseRow : { ...baseRow, password_set: existingPasswordSet }
  );

  if (upsertError) {
    return NextResponse.json({ error: `profile_upsert_failed:${upsertError.message}` }, { status: 500 });
  }

  const requirePasswordSetup = access.access_level !== "viewer" && !(existingPasswordSet ?? false);
  return NextResponse.json({ ok: true, require_password_setup: requirePasswordSetup });
}
