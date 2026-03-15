"use client";

import Link from "next/link";
import AppHeader from "../_components/AppHeader";
import { useSession } from "@/lib/useSession";

export default function DecisionsPage() {
  const session = useSession({ redirectTo: "/decisions" });
  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;
  const role = session.profile.role;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="待決策" role={role} />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 md:pl-[19rem] md:pr-6 md:py-8">
        <div>
          <Link className="text-sm text-zinc-600 hover:underline" href="/">
            ← 返回主頁
          </Link>
        </div>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-base font-semibold">待決策</h1>
          <p className="mt-2 text-sm text-zinc-600">資料將由 Notion + Gemini 分析後同步至此頁。</p>

          <div className="mt-4 rounded-xl border border-dashed bg-zinc-50 p-8 text-center">
            <div className="text-sm font-medium">目前沒有待決策項目</div>
            <div className="mt-2 text-sm text-zinc-600">等待同步資料匯入後才會顯示清單。</div>
          </div>
        </section>
      </main>
    </div>
  );
}
