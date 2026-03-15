import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient } from "../_shared/supabase.ts";

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const emailRaw = url.searchParams.get("email") ?? "";
    const email = normalizeEmail(emailRaw);

    if (!email) {
      return new Response(JSON.stringify({ error: "missing_email" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const admin = createSupabaseAdminClient();

    const { data: access, error: accessError } = await admin
      .from("access_controls")
      .select("access_level, status")
      .eq("email", email)
      .maybeSingle();

    if (accessError) {
      return new Response(JSON.stringify({ error: `access_query_failed:${accessError.message}` }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (!access || access.status !== "active") {
      return new Response(JSON.stringify({ policy: { allowed: false, mode: "magic", access_level: "viewer" } satisfies Policy }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (access.access_level === "viewer") {
      return new Response(JSON.stringify({ policy: { allowed: true, mode: "magic", access_level: "viewer" } satisfies Policy }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("password_set")
      .eq("account_id", email)
      .maybeSingle();

    if (profileError) {
      if (!isMissingPasswordSetColumn(profileError.message)) {
        return new Response(JSON.stringify({ error: `profile_query_failed:${profileError.message}` }), {
          status: 500,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ policy: { allowed: true, mode: "magic", access_level: access.access_level } satisfies Policy }),
        {
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    const mode: Mode = profile?.password_set ? "password" : "magic";
    return new Response(JSON.stringify({ policy: { allowed: true, mode, access_level: access.access_level } satisfies Policy }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
