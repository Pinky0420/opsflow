import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Mode = "magic" | "password";

type Policy = {
  allowed: boolean;
  mode: Mode;
  access_level: "viewer" | "manager" | "admin";
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isMissingPasswordSetColumn(message: string) {
  return message.includes("Could not find the 'password_set' column") || message.toLowerCase().includes("password_set");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const emailRaw = url.searchParams.get("email") ?? "";
  const email = normalizeEmail(emailRaw);

  if (!email) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: access, error: accessError } = await admin
    .from("access_controls")
    .select("access_level, status")
    .eq("email", email)
    .maybeSingle();

  if (accessError) {
    return NextResponse.json({ error: `access_query_failed:${accessError.message}` }, { status: 500 });
  }

  if (!access || access.status !== "active") {
    return NextResponse.json({ policy: { allowed: false, mode: "magic", access_level: "viewer" } satisfies Policy });
  }

  if (access.access_level === "viewer") {
    return NextResponse.json({ policy: { allowed: true, mode: "magic", access_level: "viewer" } satisfies Policy });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("password_set")
    .eq("account_id", email)
    .maybeSingle();

  if (profileError) {
    if (!isMissingPasswordSetColumn(profileError.message)) {
      return NextResponse.json({ error: `profile_query_failed:${profileError.message}` }, { status: 500 });
    }

    return NextResponse.json({ policy: { allowed: true, mode: "magic", access_level: access.access_level } satisfies Policy });
  }

  const mode: Mode = profile?.password_set ? "password" : "magic";
  return NextResponse.json({ policy: { allowed: true, mode, access_level: access.access_level } satisfies Policy });
}
