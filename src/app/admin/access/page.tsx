"use client";

import { useEffect, useState } from "react";
import AppHeader from "../../_components/AppHeader";
import AccessManagementClient from "./AccessManagementClient";
import { useSession } from "@/lib/useSession";
import { apiFetch } from "@/lib/api";

type AccessItem = {
  id: string; email: string; display_name: string | null;
  access_level: "viewer" | "manager" | "admin"; status: "active" | "disabled";
  created_at: string; updated_at: string;
  profile: { account_id: string | null; display_name: string | null; role: string; status: string } | null;
};

export default function AdminAccessPage() {
  const session = useSession({ redirectTo: "/admin/access", requiredRole: ["admin"] });
  const [items, setItems] = useState<AccessItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== "ready") return;
    apiFetch("/api/admin/access", { auth: true })
      .then((r) => r.json() as Promise<{ items?: AccessItem[]; error?: string }>)
      .then(({ items: data, error }) => {
        if (error) setLoadError(error);
        else setItems(data ?? []);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "load_failed"));
  }, [session.status]);

  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;
  const { user, profile } = session;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="權限管理" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 md:pl-[19rem] md:pr-6 md:py-8">
        <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="text-sm text-zinc-600">目前登入</div>
          <div className="mt-1 text-lg font-semibold">{profile.display_name || user.email}</div>
          <div className="mt-1 text-sm text-zinc-600">最高權限可管理可登入帳號與角色層級</div>
        </section>

        {loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>
        ) : (
          <AccessManagementClient initialItems={items} />
        )}
      </main>
    </div>
  );
}
