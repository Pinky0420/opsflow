"use client";

import AppHeader from "./_components/AppHeader";
import { useSession } from "@/lib/useSession";

export default function Home() {
  const session = useSession({ redirectTo: "/" });

  if (session.status !== "ready") {
    return <div className="min-h-screen bg-zinc-50" />;
  }

  const { user, profile } = session;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="主頁" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 md:pl-[19rem] md:pr-6 md:py-8">
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="text-sm text-zinc-600">目前登入</div>
          <div className="mt-1 text-lg font-semibold">{profile.display_name || user.email}</div>
        </section>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold">工作區</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <a href="/departments" className="rounded-xl border bg-zinc-50 px-4 py-4 text-sm font-medium hover:bg-zinc-100">各部門資訊</a>
            <a href="/decisions" className="rounded-xl border bg-zinc-50 px-4 py-4 text-sm font-medium hover:bg-zinc-100">待決策</a>
            <a href="/todos" className="rounded-xl border bg-zinc-50 px-4 py-4 text-sm font-medium hover:bg-zinc-100">待執行</a>
          </div>
        </section>
      </main>
    </div>
  );
}
