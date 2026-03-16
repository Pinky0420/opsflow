"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppHeader from "../../_components/AppHeader";
import TrainingDetailClient from "../TrainingDetailClient";
import { useSession } from "@/lib/useSession";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Material = {
  id: string; title: string; description: string | null; content_type: string;
  visibility: string; keywords: string | null; file_name: string | null;
  file_size: number | null; mime_type: string | null; status: string;
  file_bucket: string | null; file_path: string | null;
  created_at: string; updated_at: string;
};

function TrainingDetailContent() {
  const session = useSession({ redirectTo: "/training" });
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get("id") ?? "";

  const [material, setMaterial] = useState<Material | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (session.status !== "ready" || !id) return;
    createSupabaseBrowserClient()
      .from("training_materials")
      .select("id, title, description, content_type, visibility, keywords, file_name, file_size, mime_type, status, file_bucket, file_path, created_at, updated_at")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || data.status !== "active") { setNotFound(true); return; }
        setMaterial(data as Material);
      });
  }, [session.status, id]);

  useEffect(() => {
    if (!id) router.replace("/training");
  }, [id, router]);

  useEffect(() => {
    if (notFound) router.replace("/training");
  }, [notFound, router]);

  if (session.status !== "ready" || !material) return <div className="min-h-screen bg-zinc-50" />;

  const { profile } = session;
  const canManage = profile.role === "admin" || profile.role === "boss";
  const hasFile = Boolean(material.file_bucket && material.file_path);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="教育訓練資料" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 md:pr-6 md:py-8" style={{ paddingLeft: "var(--app-sidebar-offset, 0px)" }}>
        <div>
          <Link className="text-sm text-zinc-600 hover:underline" href="/training">← 返回列表</Link>
        </div>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{material.title}</h1>
          {material.description ? <p className="mt-2 text-sm text-zinc-600">{material.description}</p> : null}

          <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div className="rounded-lg border bg-zinc-50 px-3 py-2">
              <div className="text-xs text-zinc-500">類型</div>
              <div className="mt-1">{material.content_type}</div>
            </div>
            <div className="rounded-lg border bg-zinc-50 px-3 py-2">
              <div className="text-xs text-zinc-500">可見度</div>
              <div className="mt-1">{material.visibility}</div>
            </div>
            <div className="rounded-lg border bg-zinc-50 px-3 py-2">
              <div className="text-xs text-zinc-500">檔名</div>
              <div className="mt-1">{material.file_name ?? "-"}</div>
            </div>
            <div className="rounded-lg border bg-zinc-50 px-3 py-2">
              <div className="text-xs text-zinc-500">關鍵字</div>
              <div className="mt-1">{material.keywords || "-"}</div>
            </div>
          </div>

          <div className="mt-6">
            <TrainingDetailClient
              id={material.id}
              hasFile={hasFile}
              canManage={canManage}
              mimeType={material.mime_type ?? null}
              fileName={material.file_name ?? null}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default function TrainingDetailPage() {
  return <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}><TrainingDetailContent /></Suspense>;
}
