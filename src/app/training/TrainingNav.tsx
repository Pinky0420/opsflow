"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TrainingNav() {
  const pathname = usePathname();
  const isRead = pathname === "/training" || pathname.startsWith("/training/");
  const isUpload = pathname === "/training/upload";

  return (
    <div className="rounded-xl border bg-white p-1.5 shadow-sm sm:p-2">
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:gap-2">
        <Link
          href="/training"
          className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium sm:px-4 ${
            isRead && !isUpload ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          檢視
        </Link>
        <Link
          href="/training/upload"
          className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium sm:px-4 ${
            isUpload ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          上傳
        </Link>
      </div>
    </div>
  );
}
