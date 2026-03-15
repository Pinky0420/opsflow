"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export type SessionProfile = {
  display_name: string | null;
  role: string | null;
};

export type UseSessionResult =
  | { status: "loading"; user: null; profile: null }
  | { status: "unauthenticated"; user: null; profile: null }
  | { status: "ready"; user: User; profile: SessionProfile };

export function useSession(options: { redirectTo?: string; requiredRole?: string[] } = {}): UseSessionResult {
  const router = useRouter();
  const [result, setResult] = useState<UseSessionResult>({ status: "loading", user: null, profile: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          if (!cancelled) {
            setResult({ status: "unauthenticated", user: null, profile: null });
            const loginUrl = options.redirectTo
              ? `/login?redirect=${encodeURIComponent(options.redirectTo)}`
              : "/login";
            router.replace(loginUrl);
          }
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name, role")
          .eq("id", user.id)
          .maybeSingle();

        if (options.requiredRole && options.requiredRole.length > 0) {
          const role = profile?.role ?? null;
          if (!role || !options.requiredRole.includes(role)) {
            if (!cancelled) router.replace("/training");
            return;
          }
        }

        if (!cancelled) {
          setResult({
            status: "ready",
            user,
            profile: { display_name: profile?.display_name ?? null, role: profile?.role ?? null },
          });
        }
      } catch {
        if (!cancelled) setResult({ status: "unauthenticated", user: null, profile: null });
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return result;
}
