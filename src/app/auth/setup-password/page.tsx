"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";

function SetupPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    const next = searchParams.get("next");
    if (next && next.startsWith("/")) return next;
    return "/training";
  }, [searchParams]);

  useEffect(() => {
    async function ensureSession() {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace(`/login?redirect=${encodeURIComponent(redirectTo)}`);
        router.refresh();
      }
    }

    void ensureSession();
  }, [redirectTo, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!password || password.length < 8) {
      setError("密碼至少需要 8 個字元");
      return;
    }

    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致");
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      const resp = await apiFetch("/api/auth/mark-password-set", { method: "POST", auth: true });
      const payload = (await resp.json()) as { error?: string };
      if (!resp.ok) {
        setError(payload.error ?? "mark_password_failed");
        return;
      }

      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "setup_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold tracking-tight">OpsFlow</h1>
        <p className="mt-2 text-sm text-zinc-600">請先設定密碼</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-xl border bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <label className="text-sm font-medium">新密碼</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">確認新密碼</label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? "設定中..." : "設定密碼"}
          </button>

          <p className="text-xs text-zinc-500">Manager / Admin 初次登入需要先設定密碼，之後將改用帳號密碼登入。</p>
        </form>
      </div>
    </div>
  );
}

export default function SetupPasswordPage() {
  return <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}><SetupPasswordContent /></Suspense>;
}
