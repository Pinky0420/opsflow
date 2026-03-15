import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient, createSupabaseUserClient } from "../_shared/supabase.ts";
import { getBearerToken } from "../_shared/auth.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

function mapAccessLevelToRole(level: string) {
  if (level === "admin") return "admin";
  if (level === "manager") return "boss";
  return "employee";
}

function isMissingPasswordSetColumn(message: string) {
  const n = message.toLowerCase().replace(/\s+/g, " ").trim();
  return n.includes("password_set") && (n.includes("could not find") || n.includes("schema cache") || n.includes("column"));
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    const token = getBearerToken(req);
    if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    const userClient = createSupabaseUserClient(token);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    const email = user.email.toLowerCase();
    const admin = createSupabaseAdminClient();

    const { data: access, error: accessError } = await admin.from("access_controls").select("display_name, access_level, status").eq("email", email).maybeSingle();
    if (accessError) return new Response(JSON.stringify({ error: `access_query_failed:${accessError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    if (!access || access.status !== "active") {
      await userClient.auth.signOut();
      return new Response(JSON.stringify({ error: "email_not_allowed" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
    }

    let existingPasswordSet: boolean | null = null;
    const { data: existingProfile, error: existingProfileError } = await admin.from("profiles").select("password_set").eq("id", user.id).maybeSingle();
    if (existingProfileError) {
      if (!isMissingPasswordSetColumn(existingProfileError.message)) {
        return new Response(JSON.stringify({ error: `profile_query_failed:${existingProfileError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
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
    if (upsertError) return new Response(JSON.stringify({ error: `profile_upsert_failed:${upsertError.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });

    const requirePasswordSetup = access.access_level !== "viewer" && !(existingPasswordSet ?? false);
    return new Response(JSON.stringify({ ok: true, require_password_setup: requirePasswordSetup }), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
