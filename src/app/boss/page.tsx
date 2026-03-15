"use client";

import AppHeader from "../_components/AppHeader";
import { useSession } from "@/lib/useSession";

export default function BossPage() {
  const session = useSession({ redirectTo: "/boss", requiredRole: ["boss", "admin"] });

  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;

  const { user, profile } = session;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="主管決策總覽" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 md:pl-[19rem] md:pr-6 md:py-8">
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="text-sm text-zinc-600">目前登入</div>
          <div className="mt-1 text-lg font-semibold">{profile.display_name || user.email}</div>
          <div className="mt-1 text-sm text-zinc-600">role: {profile.role}</div>
        </section>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold">三區塊資料（占位）</h2>
          <p className="mt-2 text-sm text-zinc-600">下一步會在這裡加入：部門資訊 / 待決策 / 待執行 三區塊，先用 Mock 資料。</p>
        </section>
      </main>
    </div>
  );
}
