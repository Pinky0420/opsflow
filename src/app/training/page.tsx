"use client";

import { useEffect, useState } from "react";
import AppHeader from "../_components/AppHeader";
import TrainingClient from "./TrainingClient";
import TrainingNav from "./TrainingNav";
import { useSession } from "@/lib/useSession";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type RawItem = {
  id: string; title: string; description: string | null; content_type: string;
  visibility: string; keywords: string; file_name: string | null;
  file_size: number | null; mime_type: string | null; status: string;
  created_at: string; updated_at: string; file_path: string | null;
  uploaded_by: string | null; updated_by: string | null;
};

export default function TrainingPage() {
  const session = useSession({ redirectTo: "/training" });
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<(RawItem & { uploader: { account_id: string | null; display_name: string | null } | null; editor: { account_id: string | null; display_name: string | null } | null })[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (session.status !== "ready") return;
    const supabase = createSupabaseBrowserClient();

    async function load() {
      const [deptResult, itemResult] = await Promise.all([
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("training_materials")
          .select("id, title, description, content_type, visibility, keywords, file_name, file_size, mime_type, status, created_at, updated_at, file_path, uploaded_by, updated_by")
          .eq("status", "active").not("file_path", "is", null).not("file_name", "is", null)
          .order("created_at", { ascending: false }).limit(50),
      ]);

      setDepartments(deptResult.data ?? []);
      const raw = (itemResult.data ?? []) as RawItem[];
      const profileIds = Array.from(new Set(raw.flatMap((i) => [i.uploaded_by, i.updated_by]).filter(Boolean))) as string[];
      let peopleById = new Map<string, { account_id: string | null; display_name: string | null }>();

      if (profileIds.length > 0) {
        const { data: people } = await supabase.from("profiles").select("id, account_id, display_name").in("id", profileIds);
        peopleById = new Map((people ?? []).map((p) => [p.id, { account_id: p.account_id, display_name: p.display_name }] as const));
      }

      setItems(raw.map((item) => ({
        ...item,
        uploader: item.uploaded_by ? peopleById.get(item.uploaded_by) ?? null : null,
        editor: item.updated_by ? peopleById.get(item.updated_by) ?? null : null,
      })));
      setLoaded(true);
    }

    void load();
  }, [session.status]);

  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;
  const { user, profile } = session;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="教育訓練資料" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 md:pl-[19rem] md:pr-6 md:py-8">
        <TrainingNav />

        <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="text-sm text-zinc-600">目前登入</div>
          <div className="mt-1 text-lg font-semibold">{profile.display_name || user.email}</div>
          <div className="mt-1 text-sm text-zinc-600">role: {profile.role || "(no profile)"}</div>
        </section>

        {loaded ? (
          <TrainingClient
            role={profile.role}
            departments={departments}
            initialItems={items}
            mode="read"
          />
        ) : (
          <div className="rounded-xl border bg-white p-6 text-sm text-zinc-500">載入中...</div>
        )}
      </main>
    </div>
  );
}
