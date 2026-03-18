"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppHeader from "../../_components/AppHeader";
import TrainingEditForm from "../TrainingEditForm";
import { useSession } from "@/lib/useSession";
import { collection, query, orderBy, getDocs, doc, getDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

type Material = {
  id: string; title: string; description: string | null;
  content_type: string; visibility: string; keywords: string | null; status: string;
};

function TrainingEditContent() {
  const session = useSession({ redirectTo: "/training", requiredRole: ["admin", "boss"] });
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get("id") ?? "";

  const [material, setMaterial] = useState<Material | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [materialDeptIds, setMaterialDeptIds] = useState<string[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (session.status !== "ready" || !id) return;

    Promise.all([
      getDoc(doc(db, "training_materials", id)),
      getDocs(query(collection(db, "departments"), orderBy("name"))),
      getDocs(query(collection(db, "training_material_departments"), where("material_id", "==", id))),
    ]).then(([matSnap, deptSnap, matDeptSnap]) => {
      if (!matSnap.exists()) { setNotFound(true); return; }
      const mat = { id: matSnap.id, ...matSnap.data() } as Material;
      if (mat.status !== "active") { setNotFound(true); return; }
      setMaterial(mat);
      setDepartments(deptSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string }) })));
      setMaterialDeptIds(matDeptSnap.docs.map((d) => (d.data() as { department_id: string }).department_id));
    });
  }, [session.status, id]);

  useEffect(() => { if (!id) router.replace("/training"); }, [id, router]);
  useEffect(() => { if (notFound) router.replace("/training"); }, [notFound, router]);

  if (session.status !== "ready" || !material) return <div className="min-h-screen bg-zinc-50" />;

  const { profile } = session;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="教育訓練資料" role={profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 md:pr-6 md:py-8" style={{ paddingLeft: "var(--app-sidebar-offset, 0px)" }}>
        <div>
          <Link className="text-sm text-zinc-600 hover:underline" href={`/training/detail?id=${id}`}>← 返回教材詳細頁</Link>
        </div>

        <TrainingEditForm
          id={material.id}
          initialTitle={material.title}
          initialDescription={material.description ?? ""}
          initialContentType={material.content_type as "text" | "video" | "image" | "pdf" | "office" | "other"}
          initialVisibility={material.visibility as "department" | "all"}
          initialKeywords={material.keywords ?? ""}
          initialDepartmentIds={materialDeptIds}
          departments={departments}
        />
      </main>
    </div>
  );
}

export default function TrainingEditPage() {
  return <Suspense fallback={<div className="min-h-screen bg-zinc-50" />}><TrainingEditContent /></Suspense>;
}
