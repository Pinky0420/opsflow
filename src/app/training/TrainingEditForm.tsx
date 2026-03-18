"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc, collection, query, where, getDocs, addDoc, deleteDoc } from "firebase/firestore";
import { db, firebaseAuth } from "@/lib/firebase/client";

type Department = {
  id: string;
  name: string;
};

type Props = {
  id: string;
  initialTitle: string;
  initialDescription: string;
  initialContentType: "video" | "image" | "pdf" | "text" | "office" | "other";
  initialVisibility: "all" | "department";
  initialKeywords: string;
  initialDepartmentIds: string[];
  departments: Department[];
};

const CONTENT_TYPES = ["video", "image", "pdf", "text", "office", "other"] as const;
const VISIBILITIES = ["all", "department"] as const;

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_OFFICE_BYTES = 50 * 1024 * 1024;

function validateFileForUpload(f: File) {
  const name = f.name.toLowerCase();
  const isVideo = [".mp4", ".mov"].some((ext) => name.endsWith(ext));
  const isImage = [".png", ".jpg", ".jpeg", ".webp"].some((ext) => name.endsWith(ext));
  const isPdf = name.endsWith(".pdf");
  const isOffice = [".docx", ".xlsx", ".pptx"].some((ext) => name.endsWith(ext));
  const isTxt = name.endsWith(".txt");

  if (isVideo && f.size > MAX_VIDEO_BYTES) return "video_too_large";
  if (isImage && f.size > MAX_IMAGE_BYTES) return "image_too_large";
  if (isPdf && f.size > MAX_PDF_BYTES) return "pdf_too_large";
  if (isOffice && f.size > MAX_OFFICE_BYTES) return "office_too_large";
  if (!(isVideo || isImage || isPdf || isOffice || isTxt)) return "unsupported_file_type";

  return null;
}

function uploadErrorMessage(code: string) {
  if (code.startsWith("upload_failed_")) {
    const rest = code.replace("upload_failed_", "");
    const [status, detail] = rest.split(":", 2);
    const suffix = detail ? `（${detail}）` : "";
    if ((detail || "").includes("Payload too large") || (detail || "").includes("maximum allowed size")) {
      return "影片超過目前 Supabase Storage bucket 允許的大小，請調大 training-files 的 file size limit 或縮小影片檔案。";
    }
    return `檔案上傳失敗（${status}）${suffix}`;
  }

  switch (code) {
    case "missing_file":
      return "請先選擇檔案";
    case "signed_upload_failed":
      return "取得上傳連結失敗";
    case "update_failed":
      return "更新教材失敗";
    case "unsupported_file_type":
      return "不支援的檔案格式";
    case "video_too_large":
      return "影片檔案過大（上限 2GB）";
    case "image_too_large":
      return "圖片檔案過大（上限 10MB）";
    case "pdf_too_large":
      return "PDF 檔案過大（上限 50MB）";
    case "office_too_large":
      return "Office 檔案過大（上限 50MB）";
    default:
      return code;
  }
}

function saveErrorMessage(code: string) {
  switch (code) {
    case "missing_fields":
      return "請完整填寫必要欄位";
    case "missing_departments":
      return "可見度為部門時，請至少選一個部門";
    case "forbidden":
      return "你沒有編輯權限";
    case "update_failed":
      return "更新教材失敗";
    case "update_departments_failed":
      return "更新部門設定失敗";
    default:
      return code;
  }
}

export default function TrainingEditForm(props: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(props.initialTitle);
  const [description, setDescription] = useState(props.initialDescription);
  const [contentType, setContentType] = useState<Props["initialContentType"]>(props.initialContentType);
  const [visibility, setVisibility] = useState<Props["initialVisibility"]>(props.initialVisibility);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>(props.initialDepartmentIds);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>(
    props.initialKeywords
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const selectedDepartmentNames = useMemo(() => {
    const byId = new Map(props.departments.map((d) => [d.id, d.name] as const));
    return selectedDepartments.map((id) => byId.get(id)).filter(Boolean).join(", ");
  }, [props.departments, selectedDepartments]);

  function commitKeywords(raw: string) {
    const parts = raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (parts.length === 0) return;

    setKeywordTags((prev) => Array.from(new Set([...prev, ...parts])));
    setKeywordInput("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("請輸入標題");
      return;
    }

    if (visibility === "department" && selectedDepartments.length === 0) {
      setError("可見度為部門時，請至少選一個部門");
      return;
    }

    setLoading(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error(saveErrorMessage("unauthorized"));

      await updateDoc(doc(db, "training_materials", props.id), {
        title: title.trim(),
        description: description.trim() || null,
        content_type: contentType,
        visibility,
        keywords: keywordTags.join(","),
        updated_by: user.uid,
        updated_at: new Date().toISOString(),
      });

      const existingDeptSnap = await getDocs(query(collection(db, "training_material_departments"), where("material_id", "==", props.id)));
      await Promise.all(existingDeptSnap.docs.map((d) => deleteDoc(d.ref)));
      const deptIds = visibility === "department" ? selectedDepartments : [];
      if (deptIds.length > 0) {
        await Promise.all(deptIds.map((department_id) => addDoc(collection(db, "training_material_departments"), { material_id: props.id, department_id })));
      }

      if (file) {
        const fileValidationError = validateFileForUpload(file);
        if (fileValidationError) throw new Error(uploadErrorMessage(fileValidationError));

        setUploadProgress(20);
        const session = await user.getIdToken();
        const formData = new FormData();
        formData.append("file", file);
        formData.append("meta", JSON.stringify({ id: props.id, replace: true }));

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const res = await fetch(`${supabaseUrl}/functions/v1/training-upload-drive`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session}` },
          body: formData,
        });
        setUploadProgress(90);
        const json = await res.json() as { error?: string };
        if (!res.ok) throw new Error(uploadErrorMessage(json.error ?? "upload_failed"));
        setUploadProgress(100);
      }

      router.push(`/training/detail?id=${props.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新教材失敗");
    } finally {
      setLoading(false);
      setTimeout(() => setUploadProgress(null), 800);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">編輯教材</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="text-sm font-medium">標題</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10" />
        </div>
        <div>
          <label className="text-sm font-medium">類型</label>
          <select value={contentType} onChange={(e) => setContentType(e.target.value as Props["initialContentType"])} className="mt-1 h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10">
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">描述</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900/10" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="text-sm font-medium">關鍵字</label>
          {keywordTags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {keywordTags.map((t) => (
                <span key={t} className="inline-flex items-center gap-2 rounded-full bg-zinc-200 px-3 py-1 text-sm">
                  <span>{t}</span>
                  <button type="button" onClick={() => setKeywordTags((prev) => prev.filter((x) => x !== t))}>×</button>
                </span>
              ))}
            </div>
          ) : null}
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitKeywords(keywordInput);
              }
              if (e.key === "Backspace" && keywordInput === "" && keywordTags.length > 0) {
                setKeywordTags((prev) => prev.slice(0, -1));
              }
            }}
            onBlur={() => commitKeywords(keywordInput)}
            className="mt-1 h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            placeholder="輸入後按 Enter"
          />
        </div>
        <div>
          <label className="text-sm font-medium">可見度</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Props["initialVisibility"])} className="mt-1 h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10">
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {visibility === "department" ? (
        <div>
          <div className="text-sm font-medium">部門</div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {props.departments.map((d) => {
              const checked = selectedDepartments.includes(d.id);
              return (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setSelectedDepartments((prev) => {
                        if (e.target.checked) return Array.from(new Set([...prev, d.id]));
                        return prev.filter((x) => x !== d.id);
                      });
                    }}
                  />
                  <span>{d.name}</span>
                </label>
              );
            })}
          </div>
          {selectedDepartmentNames ? <div className="mt-2 text-xs text-zinc-600">已選：{selectedDepartmentNames}</div> : null}
        </div>
      ) : null}

      <div>
        <label className="text-sm font-medium">重新上傳檔案（選填）</label>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".mp4,.mov,.png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx,.txt"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-11 items-center justify-center rounded-lg border bg-white px-4 text-sm font-medium hover:bg-zinc-50">
            選擇新檔案
          </button>
          <div className="text-sm text-zinc-700">{file ? file.name : "未選擇新檔案（若舊檔損壞可在此重傳）"}</div>
        </div>
        <div className="mt-2 text-xs text-zinc-600">支援：mp4/mov (≤2GB) 、png/jpg/jpeg/webp (≤10MB) 、pdf (≤50MB) 、docx/xlsx/pptx (≤50MB) 、txt</div>
      </div>

      {typeof uploadProgress === "number" ? (
        <div className="rounded-lg border bg-white px-3 py-3">
          <div className="flex items-center justify-between text-xs text-zinc-600">
            <div>檔案上傳進度</div>
            <div>{uploadProgress}%</div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-2 bg-zinc-900" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      ) : null}

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="flex gap-3">
        <button type="submit" disabled={loading} className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60">{loading ? "儲存中..." : "儲存修改"}</button>
        <button type="button" onClick={() => router.push(`/training/${props.id}`)} className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium">取消</button>
      </div>
    </form>
  );
}
