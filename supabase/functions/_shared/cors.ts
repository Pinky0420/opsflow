export function corsHeaders(origin: string | null) {
  const denoEnv = (globalThis as unknown as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno;
  const allowedOriginsRaw = denoEnv?.env?.get?.("ALLOWED_ORIGINS") ?? "";
  const allowed = allowedOriginsRaw
    .split(",")
    .map((v: string) => v.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    });

  const allowOrigin = (() => {
    if (!origin) return "*";
    if (allowed.length === 0) return origin;
    return allowed.includes(origin) ? origin : allowed[0] ?? "*";
  })();

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  } as const;
}
