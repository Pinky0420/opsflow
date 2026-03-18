"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
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
    if (code === "auth/user-not-found") return "此 Email 尚未開通登入權限。";
    if (code === "auth/wrong-password") return "密碼錯誤，請確認後再試。";
    if (code === "auth/invalid-credential") return "Email 或密碼錯誤，請確認後再試。";
    if (code === "auth/too-many-requests") return "嘗試次數過多，請稍後再試。";
    if (code === "auth/invalid-email") return "Email 格式不正確。";
    if (code === "missing_code") return "登入驗證連結缺少必要資訊，請重新索取。";
    if (code.startsWith("send_link_failed:")) return `寄送登入連結失敗：${code.replace("send_link_failed:", "")}`;
    return code;
  }

  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setPolicyHint(null);
      return;
    }
    const id = ++policyRequestId.current;
    const timer = window.setTimeout(() => {
      if (id !== policyRequestId.current) return;
      setPolicyHint(mode === "password" ? "請輸入密碼登入" : "將寄送登入連結到信箱");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [email, mode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (mode === "password") {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
        window.location.assign(appPath(redirectTo));
        return;
      }

      const actionCodeSettings = {
        url: `${window.location.origin}${appPath("/auth/finish")}?next=${encodeURIComponent(redirectTo)}`,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(firebaseAuth, email.trim(), actionCodeSettings);
      window.localStorage.setItem("emailForSignIn", email.trim());
      setSuccess("登入連結已寄到你的信箱，請點信件中的連結完成登入。");
    } catch (err) {
      const code = (err as { code?: string })?.code ?? (err instanceof Error ? err.message : "request_failed");
      setError(errorMessage(code));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isSignInWithEmailLink(firebaseAuth, window.location.href)) {
      const savedEmail = window.localStorage.getItem("emailForSignIn") ?? "";
      const emailToUse = savedEmail || (window.prompt("請輸入你的 Email 以完成登入：") ?? "");
      if (!emailToUse) return;
      signInWithEmailLink(firebaseAuth, emailToUse, window.location.href)
        .then(() => {
          window.localStorage.removeItem("emailForSignIn");
          window.location.assign(appPath(redirectTo));
        })
        .catch((err: unknown) => {
          setError((err as { code?: string })?.code ?? "finish_failed");
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
