"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`/auth/finish?${params.toString()}${hash}`);
  }, []);

  return <div className="min-h-screen bg-zinc-50" />;
}

export default function AuthCallbackPage() {
  return <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}><AuthCallbackContent /></Suspense>;
}
