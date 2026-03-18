"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppHeader from "../_components/AppHeader";
import { useSession } from "@/lib/useSession";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export default function DepartmentsPage() {
  const session = useSession({ redirectTo: "/departments" });
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (session.status !== "ready") return;
    getDocs(query(collection(db, "departments"), orderBy("name"))).then((snap) => setDepartments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string }) }))));
  }, [session.status]);

  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="各部門資訊" role={session.profile.role} />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 md:pl-[19rem] md:pr-6 md:py-8">
        <div>
          <Link className="text-sm text-zinc-600 hover:underline" href="/">
            ← 返回主頁
          </Link>
        </div>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h1 className="text-base font-semibold">部門清單</h1>
          <div className="mt-4 space-y-2">
            {(departments ?? []).length === 0 ? (
              <div className="text-sm text-zinc-600">尚未建立部門</div>
            ) : (
              (departments ?? []).map((d) => (
                <div key={d.id} className="rounded-lg border bg-zinc-50 px-3 py-2 text-sm">
                  {d.name}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
