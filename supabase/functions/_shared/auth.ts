import { createSupabaseAdminClient, createSupabaseUserClient } from "./supabase.ts";

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function getAuthUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { user: null, error: "missing_token" as const };

  const supabase = createSupabaseUserClient(token);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { user: null, error: "unauthorized" as const };

  return { user, error: null };
}

export async function requireAdminUser(req: Request) {
  const { user, error } = await getAuthUser(req);
  if (!user) return { user: null, error };

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "admin") return { user: null, error: "forbidden" as const };

  return { user, error: null };
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
