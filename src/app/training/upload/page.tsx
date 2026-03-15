"use client";

import { useEffect, useState } from "react";
import AppHeader from "../../_components/AppHeader";
import TrainingClient from "../TrainingClient";
import TrainingNav from "../TrainingNav";
import { useSession } from "@/lib/useSession";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function TrainingUploadPage() {
  const session = useSession({ redirectTo: "/training/upload", requiredRole: ["admin", "boss", "uploader"] });
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (session.status !== "ready") return;
    createSupabaseBrowserClient().from("departments").select("id, name").order("name").then(({ data }) => setDepartments(data ?? []));
  }, [session.status]);

  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;
  const { user, profile } = session;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="教育訓練資料" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 md:pl-[19rem] md:pr-6 md:py-8">
        <TrainingNav />

        <TrainingClient
          role={profile.role}
          departments={departments}
          initialItems={[]}
          mode="upload"
          currentUploaderName={profile.display_name || user.email || "未知使用者"}
        />
      </main>
    </div>
  );
}
