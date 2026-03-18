"use client";

import { useEffect, useState } from "react";
import AppHeader from "../_components/AppHeader";
import TrainingClient from "./TrainingClient";
import TrainingNav from "./TrainingNav";
import { useSession } from "@/lib/useSession";
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

type RawItem = {
  id: string; title: string; description: string | null; content_type: string;
  visibility: string; keywords: string; file_name: string | null;
  file_size: number | null; mime_type: string | null; status: string;
  created_at: string; updated_at: string; file_path: string | null;
  uploaded_by: string | null; updated_by: string | null;
};

export default function TrainingPage() {
  const session = useSession({ redirectTo: "/training" });
  const [pageState, setPageState] = useState<{
    departments: { id: string; name: string }[];
    items: (RawItem & { uploader: { account_id: string | null; display_name: string | null } | null; editor: { account_id: string | null; display_name: string | null } | null })[];
    loaded: boolean;
  }>({ departments: [], items: [], loaded: false });

  useEffect(() => {
    if (session.status !== "ready") return;

    async function load() {
      const [deptSnap, itemSnap] = await Promise.all([
        getDocs(query(collection(db, "departments"), orderBy("name"))),
        getDocs(query(
          collection(db, "training_materials"),
          where("status", "==", "active"),
          where("file_path", "!=", ""),
          orderBy("file_path"),
          orderBy("created_at", "desc"),
          limit(50)
        )),
      ]);

      const depts = deptSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string }) }));
      const raw: RawItem[] = itemSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawItem, "id">) }));

      const profileIds = Array.from(new Set(raw.flatMap((i) => [i.uploaded_by, i.updated_by]).filter((x): x is string => !!x)));
      const peopleById = new Map<string, { account_id: string | null; display_name: string | null }>();
      if (profileIds.length > 0) {
        const snaps = await Promise.all(profileIds.map((uid) => getDoc(doc(db, "users", uid))));
        snaps.forEach((s) => {
          if (s.exists()) {
            const d = s.data() as { account_id?: string; display_name?: string };
            peopleById.set(s.id, { account_id: d.account_id ?? null, display_name: d.display_name ?? null });
          }
        });
      }

      setPageState({
        departments: depts,
        items: raw.map((item) => ({
          ...item,
          uploader: item.uploaded_by ? peopleById.get(item.uploaded_by) ?? null : null,
          editor: item.updated_by ? peopleById.get(item.updated_by) ?? null : null,
        })),
        loaded: true,
      });
    }

    void load();
  }, [session.status]);

  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;
  const { user, profile } = session;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="教育訓練資料" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 md:pr-6 md:py-8" style={{ paddingLeft: "var(--app-sidebar-offset, 0px)" }}>
        <TrainingNav />

        <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
          <div className="text-sm text-zinc-600">目前登入</div>
          <div className="mt-1 text-lg font-semibold">{profile.display_name || user.email}</div>
          <div className="mt-1 text-sm text-zinc-600">role: {profile.role || "(no profile)"}</div>
        </section>

        {pageState.loaded ? (
          <TrainingClient
            role={profile.role}
            departments={pageState.departments}
            initialItems={pageState.items}
            mode="read"
          />
        ) : (
          <div className="rounded-xl border bg-white p-6 text-sm text-zinc-500">載入中...</div>
        )}
      </main>
    </div>
  );
}
