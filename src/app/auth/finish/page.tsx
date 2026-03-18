"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { appPath } from "@/lib/appPath";

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
        if (!isSignInWithEmailLink(firebaseAuth, window.location.href)) {
          setError("無效的登入連結，請重新索取。");
          return;
        }

        const savedEmail = window.localStorage.getItem("emailForSignIn") ?? "";
        const emailToUse = savedEmail || (window.prompt("請輸入你的 Email 以完成登入：") ?? "");
        if (!emailToUse) {
          setError("請輸入 Email 才能完成登入。");
          return;
        }

        await signInWithEmailLink(firebaseAuth, emailToUse, window.location.href);
        window.localStorage.removeItem("emailForSignIn");

        if (!cancelled) {
          window.location.assign(appPath(redirectTo));
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as { message?: string })?.message ?? "finish_failed");
        }
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
