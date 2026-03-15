import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient, createSupabaseUserClient } from "../_shared/supabase.ts";
import { getBearerToken } from "../_shared/auth.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

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
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("profiles").update({ password_set: true }).eq("id", user.id);

    if (error) {
      if (isMissingPasswordSetColumn(error.message)) {
        return new Response(JSON.stringify({ ok: true, warning: "missing_password_set_column" }), { headers: { ...headers, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `mark_password_failed:${error.message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: `internal_error:${message}` }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
