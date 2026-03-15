import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RequestLoginLinkBody = {
  email?: string;
  redirect?: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function mapAccessLevelToRole(level: "viewer" | "manager" | "admin") {
  if (level === "admin") return "admin";
  if (level === "manager") return "boss";
  return "employee";
}

function isMissingPasswordSetColumn(message: string) {
  return message.includes("Could not find the 'password_set' column") || message.toLowerCase().includes("password_set");
}

function isEmailRateLimited(message: string) {
  const m = message.toLowerCase();
  return m.includes("rate limit") || m.includes("too many") || m.includes("over_email_send_rate_limit");
}

export async function POST(request: Request) {
  let body: RequestLoginLinkBody;
  try {
    body = (await request.json()) as RequestLoginLinkBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  if (!email) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const redirectPath = body.redirect && body.redirect.startsWith("/") ? body.redirect : "/training";
  const admin = createSupabaseAdminClient();

  const { data: access, error: accessError } = await admin
    .from("access_controls")
    .select("email, display_name, access_level, status")
    .eq("email", email)
    .maybeSingle();

  if (accessError) {
    return NextResponse.json({ error: `access_query_failed:${accessError.message}` }, { status: 500 });
  }

  if (!access || access.status !== "active") {
    return NextResponse.json({ error: "email_not_allowed" }, { status: 403 });
  }

  const role = mapAccessLevelToRole(access.access_level);

  if (access.access_level !== "viewer") {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("password_set")
      .eq("account_id", email)
      .maybeSingle();

    if (profileError) {
      if (!isMissingPasswordSetColumn(profileError.message)) {
        return NextResponse.json({ error: `profile_query_failed:${profileError.message}` }, { status: 500 });
      }
    }

    if (profile?.password_set) {
      return NextResponse.json({ error: "password_required" }, { status: 409 });
    }
  }

  const redirectTo = `${origin}/auth/finish?next=${encodeURIComponent(redirectPath)}`;
  const { error } = await admin.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      data: {
        invited: true,
        role,
        name: access.display_name ?? email,
      },
    },
  });

  if (error) {
    if (isEmailRateLimited(error.message)) {
      return NextResponse.json({ error: "email_rate_limited" }, { status: 429 });
    }

    return NextResponse.json({ error: `send_link_failed:${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
