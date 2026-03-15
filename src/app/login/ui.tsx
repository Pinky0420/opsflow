"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { appPath } from "@/lib/appPath";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = useMemo(() => {
    const redirect = searchParams.get("redirect");
    if (redirect && redirect.startsWith("/")) return redirect;
    return "/training";
  }, [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [policyHint, setPolicyHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const policyRequestId = useRef(0);

  const initialError = searchParams.get("error");

  function errorMessage(code: string) {
    if (code === "email_not_allowed") return "這個 Email 尚未開通登入權限，請先由最高權限管理者新增。";
    if (code === "email_rate_limited") return "寄送登入連結太頻繁，請稍後再試（建議等待幾分鐘）。";
    if (code === "password_required") return "此帳號需使用密碼登入。請輸入密碼。";
    if (code === "missing_code") return "登入驗證連結缺少必要資訊，請重新索取。";
    if (code === "missing_user") return "無法取得登入使用者資訊，請重新索取登入連結。";
    if (code.startsWith("send_link_failed:")) return `寄送登入連結失敗：${code.replace("send_link_failed:", "")}`;
    if (code.startsWith("access_query_failed:")) return `權限檢查失敗：${code.replace("access_query_failed:", "")}`;
    if (code.startsWith("profile_query_failed:")) return `權限檢查失敗：${code.replace("profile_query_failed:", "")}`;
    return code;
  }

  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setPolicyHint(null);
      return;
    }

    const id = ++policyRequestId.current;
    const timer = window.setTimeout(async () => {
      try {
        const resp = await apiFetch(`/api/auth/login-policy?email=${encodeURIComponent(trimmed)}`);
        const payload = (await resp.json()) as {
          error?: string;
          policy?: { allowed: boolean; mode: "magic" | "password"; access_level: "viewer" | "manager" | "admin" };
        };

        if (id !== policyRequestId.current) return;

        if (!resp.ok || !payload.policy) {
          setPolicyHint(null);
          return;
        }

        if (!payload.policy.allowed) {
          setPolicyHint("此 Email 尚未開通登入權限");
          setMode("magic");
          return;
        }

        setMode(payload.policy.mode);
        if (payload.policy.mode === "password") {
          setPolicyHint("此帳號需使用密碼登入（若是測試信箱收不到信，請由管理者先設定密碼）");
        } else if (payload.policy.access_level !== "viewer") {
          setPolicyHint("首次登入會寄送登入連結，登入後需設定密碼");
        } else {
          setPolicyHint("將寄送登入連結到信箱");
        }
      } catch {
        if (id !== policyRequestId.current) return;
        setPolicyHint(null);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [email]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (mode === "password") {
        const supabase = createSupabaseBrowserClient();
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
          return;
        }

        const syncResp = await apiFetch("/api/auth/sync-profile", { method: "POST", auth: true });
        const syncPayload = (await syncResp.json()) as { error?: string; require_password_setup?: boolean };
        if (!syncResp.ok) {
          await supabase.auth.signOut();
          setError(errorMessage(syncPayload.error ?? "sync_failed"));
          return;
        }

        if (syncPayload.require_password_setup) {
          router.replace(`/auth/setup-password?next=${encodeURIComponent(redirectTo)}`);
          router.refresh();
          return;
        }

        window.location.assign(appPath(redirectTo));
        return;
      }

      const response = await apiFetch("/api/auth/request-login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirect: redirectTo,
        }),
      });

      const payload = (await response.json()) as { error?: string; ok?: boolean };

      if (!response.ok) {
        if (payload.error === "password_required") {
          setMode("password");
          setError(errorMessage(payload.error));
          return;
        }

        setError(errorMessage(payload.error ?? "request_failed"));
        return;
      }

      setSuccess("登入連結已寄到你的信箱，請點信件中的連結完成登入。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "request_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold tracking-tight">OpsFlow</h1>
        <p className="mt-2 text-sm text-zinc-600">內部管理系統登入</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-xl border bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
                setSuccess(null);
              }}
              className="h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>

          {policyHint ? <div className="text-xs text-zinc-500">{policyHint}</div> : null}

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === "password" ? "magic" : "password"));
                setError(null);
                setSuccess(null);
              }}
              className="text-xs font-medium text-zinc-700 underline underline-offset-4 hover:text-zinc-900"
            >
              {mode === "password" ? "改用寄送登入連結" : "使用密碼登入"}
            </button>
          </div>

          {mode === "password" ? (
            <div className="space-y-1">
              <label className="text-sm font-medium">密碼</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
              />
            </div>
          ) : null}

          {error || initialError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error ?? errorMessage(initialError ?? "")}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {mode === "password" ? (loading ? "登入中..." : "使用密碼登入") : loading ? "寄送中..." : "寄送登入連結"}
          </button>

          <p className="text-xs text-zinc-500">
            請輸入已開通權限的 Email。
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginForm() {
  return <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}><LoginFormContent /></Suspense>;
}
