"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";

function AuthFinishContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const next = searchParams.get("next");
      const redirectTo = next && next.startsWith("/") ? next : "/training";

      try {
        const supabase = createSupabaseBrowserClient();

        const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
        const hashParams = new URLSearchParams(hash);
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const code = searchParams.get("code");

        if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) {
            setError(setSessionError.message);
            return;
          }
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            setError(exchangeError.message);
            return;
          }
        } else {
          setError("missing_session");
          return;
        }

        const syncResp = await apiFetch("/api/auth/sync-profile", { method: "POST", auth: true });
        const syncPayload = (await syncResp.json()) as { error?: string; require_password_setup?: boolean };
        if (!syncResp.ok) {
          setError(syncPayload.error ?? "sync_failed");
          return;
        }

        if (syncPayload.require_password_setup) {
          if (!cancelled) {
            router.replace(`/auth/setup-password?next=${encodeURIComponent(redirectTo)}`);
            router.refresh();
          }
          return;
        }

        if (!cancelled) {
          router.replace(redirectTo);
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "finish_failed");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold tracking-tight">OpsFlow</h1>
        <p className="mt-2 text-sm text-zinc-600">登入驗證中...</p>

        <div className="mt-8 rounded-xl border bg-white p-6 shadow-sm">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : (
            <div className="text-sm text-zinc-600">請稍候，系統正在完成登入。</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuthFinishPage() {
  return <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}><AuthFinishContent /></Suspense>;
}
