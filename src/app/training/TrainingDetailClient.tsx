"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

type Props = {
  id: string;
  hasFile: boolean;
  canManage: boolean;
  mimeType: string | null;
  fileName: string | null;
  filePath: string | null;
  fileBucket: string | null;
};

function guessPreviewKind(mimeType: string | null, fileName: string | null) {
  const mime = (mimeType ?? "").toLowerCase();
  const name = (fileName ?? "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";

  if (mime.includes("pdf") || ext === "pdf") return "pdf" as const;
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image" as const;
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "m4v"].includes(ext)) return "video" as const;
  if (
    mime.includes("officedocument") ||
    mime.includes("msword") ||
    mime.includes("msexcel") ||
    mime.includes("mspowerpoint") ||
    ["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)
  )
    return "office" as const;
  return "iframe" as const;
}

function downloadErrorMessage(code: string) {
  if (code.startsWith("Invalid key:")) {
    return "這份教材的舊檔案路徑格式不正確，請由有權限的人重新上傳檔案。";
  }

  switch (code) {
    case "no_file":
      return "目前沒有可開啟的檔案";
    case "forbidden":
      return "你沒有權限檢視這份教材";
    case "not_found":
      return "找不到這份教材";
    case "Object not found":
      return "找不到實際檔案，可能是先前上傳未完成，請重新上傳";
    case "The resource was not found":
      return "找不到實際檔案，可能是先前上傳未完成，請重新上傳";
    case "signed_download_failed":
      return "產生下載連結失敗";
    default:
      return code;
  }
}

export default function TrainingDetailClient({ id, hasFile, canManage, mimeType, fileName, filePath, fileBucket }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function getFileUrl(forDownload = false): string | null {
    if (!filePath) return null;
    if (fileBucket === "google-drive") {
      return forDownload
        ? `https://drive.google.com/uc?export=download&id=${filePath}`
        : `https://drive.google.com/file/d/${filePath}/view`;
    }
    return null;
  }

  async function onDownload() {
    setLoading(true);
    setError(null);
    try {
      if (!hasFile) { setError(downloadErrorMessage("no_file")); return; }
      const url = getFileUrl(true);
      if (!url) { setError(downloadErrorMessage("no_file")); return; }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : downloadErrorMessage("download_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    if (!canManage) return;
    const ok = window.confirm("確定要刪除這份教材嗎？");
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      await updateDoc(doc(db, "training_materials", id), { status: "deleted" });
      router.push("/training");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除教材失敗");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onDownload}
          disabled={loading || !hasFile}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {loading ? "產生連結中..." : "下載 / 開啟"}
        </button>

        <button
          type="button"
          onClick={async () => {
            setPreviewLoading(true);
            setError(null);
            try {
              if (!hasFile) {
                setError(downloadErrorMessage("no_file"));
                return;
              }

                      const url = getFileUrl(false);
              if (!url) throw new Error(downloadErrorMessage("no_file"));
              setPreviewUrl(url);
            } catch (e) {
              setPreviewUrl(null);
              setError(e instanceof Error ? e.message : downloadErrorMessage("download_failed"));
            } finally {
              setPreviewLoading(false);
            }
          }}
          disabled={previewLoading || !hasFile}
          className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
        >
          {previewLoading ? "載入預覽中..." : "網頁預覽"}
        </button>

        {canManage ? (
          <>
            <Link href={`/training/edit?id=${id}`} className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-zinc-50">
              編輯
            </Link>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {deleting ? "刪除中..." : "刪除"}
            </button>
          </>
        ) : null}
      </div>

      {previewUrl ? (
        <div className="rounded-lg border bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm text-zinc-600">
              預覽：<span className="text-zinc-900">{fileName ?? "檔案"}</span>
            </div>
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              className="inline-flex h-9 items-center justify-center rounded border px-3 text-xs hover:bg-zinc-50"
            >
              關閉預覽
            </button>
          </div>

          <div className="mt-3 overflow-hidden rounded border bg-zinc-50">
            {(() => {
              const kind = guessPreviewKind(mimeType, fileName);
              if (kind === "image") {
                return (
                  <div className="flex justify-center p-3">
                    <img src={previewUrl} alt={fileName ?? "preview"} className="max-h-[70vh] w-auto max-w-full rounded" />
                  </div>
                );
              }
              if (kind === "video") {
                return (
                  <video className="max-h-[70vh] w-full" controls src={previewUrl} />
                );
              }
              if (kind === "office") {
                const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`;
                return <iframe title="office-preview" src={officeUrl} className="h-[70vh] w-full" />;
              }
              return <iframe title="file-preview" src={previewUrl} className="h-[70vh] w-full" />;
            })()}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <div>{error}</div>
          {canManage && error.includes("重新上傳檔案") ? (
            <Link href={`/training/edit?id=${id}`} className="inline-flex rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
              前往編輯 / 重新上傳
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
