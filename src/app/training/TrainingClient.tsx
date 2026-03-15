"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { uploadTrainingFile } from "@/lib/training/upload-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";

type Department = {
  id: string;
  name: string;
};

type TrainingMaterialListItem = {
  id: string;
  title: string;
  description: string | null;
  content_type: string;
  visibility: string;
  keywords: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  uploaded_by?: string | null;
  updated_by?: string | null;
  uploader?: {
    account_id: string | null;
    display_name: string | null;
  } | null;
  editor?: {
    account_id: string | null;
    display_name: string | null;
  } | null;
};

type Props = {
  role: string | null;
  departments: Department[];
  initialItems: TrainingMaterialListItem[];
  mode: "read" | "upload";
  currentUploaderName?: string;
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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"]; 
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getProfileDisplayName(profile?: { account_id: string | null; display_name: string | null } | null) {
  return profile?.display_name || profile?.account_id || null;
}

function uploadErrorMessage(code: string) {
  if (code.startsWith("upload_failed_")) {
    const rest = code.replace("upload_failed_", "");
    const [status, detail] = rest.split(":", 2);
    const suffix = detail ? `（${detail}）` : "";
    if ((detail || "").includes("Payload too large") || (detail || "").includes("maximum allowed size")) {
      return "影片超過目前 Supabase Storage bucket 允許的大小，請調大 training-files 的 file size limit 或縮小影片檔案。";
    }
    if (status === "400") return `檔案上傳失敗（400），請檢查檔名格式或上傳參數${suffix}`;
    if (status === "403") return `檔案上傳失敗（403），可能沒有寫入權限${suffix}`;
    return `檔案上傳失敗（${status}），請稍後重試${suffix}`;
  }
  switch (code) {
    case "missing_title":
      return "請輸入標題";
    case "missing_file":
      return "請先選擇檔案";
    case "missing_departments":
      return "可見度為部門時，請至少選擇一個部門";
    case "create_failed":
      return "建立教材資料失敗";
    case "update_failed":
      return "更新教材失敗，請確認資料表已套用最新欄位";
    case "signed_upload_failed":
      return "取得上傳連結失敗";
    case "upload_failed":
      return "檔案上傳失敗，請稍後重試";
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
    case "forbidden":
      return "你沒有上傳權限";
    default:
      return code;
  }
}

export default function TrainingClient({ role, departments, initialItems, mode, currentUploaderName }: Props) {
  const canUpload = role === "admin" || role === "boss" || role === "uploader";
  const canManage = role === "admin" || role === "boss";

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<TrainingMaterialListItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [contentType, setContentType] = useState("");
  const [visibility, setVisibility] = useState("");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordTags, setKeywordTags] = useState<string[]>([]);
  const [uploadContentType, setUploadContentType] = useState<(typeof CONTENT_TYPES)[number]>("pdf");
  const [uploadVisibility, setUploadVisibility] = useState<(typeof VISIBILITIES)[number]>("all");
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const selectedDepartmentNames = useMemo(() => {
    const byId = new Map(departments.map((d) => [d.id, d.name] as const));
    return selectedDepartments.map((id) => byId.get(id)).filter(Boolean).join(", ");
  }, [departments, selectedDepartments]);

  function commitKeywords(raw: string) {
    const parts = raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (parts.length === 0) return;

    setKeywordTags((prev) => {
      const set = new Set(prev);
      for (const p of parts) set.add(p);
      return Array.from(set);
    });
    setKeywordInput("");
  }

  async function refreshList() {
    setLoading(true);
    setListError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = supabase.from("training_materials")
        .select("id, title, description, content_type, visibility, keywords, file_name, file_size, mime_type, status, created_at, updated_at, file_path, uploaded_by, updated_by")
        .eq("status", "active").not("file_path", "is", null).not("file_name", "is", null)
        .order("created_at", { ascending: false }).limit(50);
      if (search.trim()) {
        const s = search.trim().replace(/[%_]/g, "\\$&");
        query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%,keywords.ilike.%${s}%`);
      }
      if (contentType) query = query.eq("content_type", contentType);
      if (visibility) query = query.eq("visibility", visibility);
      const { data, error } = await query;
      if (error) throw new Error((error as { message?: string }).message || "fetch_failed");
      const raw = (data ?? []) as (TrainingMaterialListItem & { uploaded_by?: string | null; updated_by?: string | null; keywords?: string | null })[];
      const profileIds = Array.from(new Set(raw.flatMap((i) => [i.uploaded_by, i.updated_by]).filter(Boolean))) as string[];
      let peopleById = new Map<string, { account_id: string | null; display_name: string | null }>();
      if (profileIds.length > 0) {
        const { data: people } = await supabase.from("profiles").select("id, account_id, display_name").in("id", profileIds);
        peopleById = new Map((people ?? []).map((p) => [p.id, { account_id: p.account_id ?? null, display_name: p.display_name ?? null }] as const));
      }
      setItems(raw.map((item) => ({ ...item, keywords: item.keywords ?? "", uploader: item.uploaded_by ? peopleById.get(item.uploaded_by) ?? null : null, editor: item.updated_by ? peopleById.get(item.updated_by) ?? null : null })));
    } catch (e) {
      setListError(e instanceof Error ? e.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string) {
    if (!canManage) return;
    const ok = window.confirm("確定要刪除這份教材嗎？");
    if (!ok) return;

    setDeletingId(id);
    setDeleteError(null);
    try {
      const { error } = await createSupabaseBrowserClient().from("training_materials").update({ status: "deleted" }).eq("id", id).eq("status", "active");
      if (error) throw new Error(error.message || "delete_failed");
      setItems((prev) => prev.filter((x) => x.id !== id));
      setSelectedIds((prev) => prev.filter((x) => x !== id));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function onBulkDelete() {
    if (!canManage || selectedIds.length === 0) return;
    const ok = window.confirm(`確定要刪除已勾選的 ${selectedIds.length} 筆教材嗎？`);
    if (!ok) return;

    setBulkDeleting(true);
    setDeleteError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      for (const id of selectedIds) {
        const { error } = await supabase.from("training_materials").update({ status: "deleted" }).eq("id", id).eq("status", "active");
        if (error) throw new Error(error.message || "delete_failed");
      }

      setItems((prev) => prev.filter((x) => !selectedIds.includes(x.id)));
      setSelectedIds([]);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError(null);
    setUploadOk(null);

    if (!canUpload) {
      setUploadError(uploadErrorMessage("forbidden"));
      return;
    }

    if (!title.trim()) {
      setUploadError(uploadErrorMessage("missing_title"));
      return;
    }

    if (!file) {
      setUploadError(uploadErrorMessage("missing_file"));
      return;
    }

    const fileValidationError = validateFileForUpload(file);
    if (fileValidationError) {
      setUploadError(uploadErrorMessage(fileValidationError));
      return;
    }

    if (uploadVisibility === "department" && selectedDepartments.length === 0) {
      setUploadError(uploadErrorMessage("missing_departments"));
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStep("驗證身份...");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw new Error(`auth_error: ${authErr.message}`);
      if (!user) throw new Error("unauthorized");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("unauthorized");

      const insertBody = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        content_type: uploadContentType,
        visibility: uploadVisibility,
        keywords: keywordTags.join(","),
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
        uploaded_by: user.id,
        status: "active",
      };

      setUploadStep("建立教材記錄...");
      const { data: material, error: insertError } = await supabase.from("training_materials").insert(insertBody).select("id").single();
      if (insertError || !material) throw new Error(`create_failed: ${insertError?.message || insertError?.code || "no data returned"}`);

      const deptIds = uploadVisibility === "department" ? selectedDepartments : [];
      if (deptIds.length > 0) {
        await supabase.from("training_material_departments").insert(deptIds.map((department_id) => ({ material_id: material.id, department_id })));
      }

      const id = material.id;
      setUploadStep(`取得上傳連結... (id: ${id.slice(0, 8)})`);

      const signedRes = await apiFetch(`/api/training/${id}/upload-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        auth: true,
        body: JSON.stringify({ file_name: file.name, content_type: file.type || "application/octet-stream", file_size: file.size }),
      } as Parameters<typeof apiFetch>[1]);

      const signedJson = (await signedRes.json()) as { bucket?: string; signedUrl?: string; token?: string; path?: string; error?: string };
      if (!signedRes.ok || !signedJson.signedUrl || !signedJson.path) {
        throw new Error(`signed_upload_failed: HTTP ${signedRes.status} ${signedJson.error || ""}`);
      }

      setUploadStep("上傳檔案中...");
      const uploaded = await uploadTrainingFile({
        file,
        uploadContentType,
        uploadTarget: {
          bucket: signedJson.bucket || "training-files",
          objectPath: signedJson.path,
          signedUrl: signedJson.signedUrl,
        },
        onProgress: (p) => setUploadProgress(p),
      });

      setUploadStep("更新資料庫...");
      const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/$/, "");
      const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
      if (!apiBase) throw new Error("update_failed: missing_api_base_url");
      if (!anonKey) throw new Error("update_failed: missing_anon_key");
      const completeRes = await fetch(`${apiBase}/training-complete-upload`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          material_id: id,
          file_path: uploaded.filePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: uploaded.mimeType,
        }),
      });
      const completeJson = (await completeRes.json()) as { ok?: boolean; error?: string };
      if (!completeRes.ok || !completeJson.ok) {
        throw new Error(`update_failed: HTTP ${completeRes.status} ${completeJson.error || ""}`);
      }

      setUploadOk(id);
      setUploadStep(null);
      setTitle("");
      setDescription("");
      setKeywordInput("");
      setKeywordTags([]);
      setUploadVisibility("all");
      setSelectedDepartments([]);
      setFile(null);
      setUploadProgress(100);

      await refreshList();
    } catch (e) {
      const raw = e instanceof Error ? e.message : "upload_failed";
      const colonIdx = raw.indexOf(":");
      const code = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : raw;
      const detail = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : "";
      setUploadError(uploadErrorMessage(code) + (detail ? `\n[${detail}]` : ""));
      setUploadStep(null);
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(null), 800);
    }
  }

  return (
    <div className="space-y-6">
      {mode === "read" ? (
        <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end">
          <div className="min-w-0">
            <label className="text-sm font-medium">搜尋</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
              placeholder="標題 / 描述 / 關鍵字"
            />
          </div>
          <div className="w-full md:w-auto">
            <label className="text-sm font-medium">類型</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            >
              <option value="">全部</option>
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full md:w-auto">
            <label className="text-sm font-medium">可見度</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            >
              <option value="">全部</option>
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={refreshList}
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 md:w-auto"
          >
            {loading ? "載入中..." : "搜尋"}
          </button>
        </div>

        {listError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {listError}
          </div>
        ) : null}

        {deleteError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {deleteError}
          </div>
        ) : null}

        {canManage ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-zinc-50 px-3 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={items.length > 0 && selectedIds.length === items.length}
                onChange={(e) => setSelectedIds(e.target.checked ? items.map((x) => x.id) : [])}
              />
              <span>全選</span>
            </label>

            <div className="flex items-center gap-3">
              <div className="text-sm text-zinc-600">已選 {selectedIds.length} 筆</div>
              <button
                type="button"
                onClick={onBulkDelete}
                disabled={bulkDeleting || selectedIds.length === 0}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {bulkDeleting ? "批次刪除中..." : "批次刪除"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-3 md:hidden">
          {items.length === 0 ? (
            <div className="rounded-lg border px-3 py-6 text-sm text-zinc-600">目前沒有資料</div>
          ) : (
            items.map((m) => (
              <div key={m.id} className="rounded-lg border bg-white px-3 py-3 text-sm shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/training/detail?id=${m.id}`} className="font-medium break-words hover:underline">
                      {m.title}
                    </Link>
                    {m.description ? <div className="mt-1 text-xs text-zinc-600 break-words">{m.description}</div> : null}
                  </div>
                  {canManage ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(m.id)}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          if (e.target.checked) return Array.from(new Set([...prev, m.id]));
                          return prev.filter((x) => x !== m.id);
                        });
                      }}
                    />
                  ) : null}
                </div>

                <div className="mt-3 space-y-1 text-xs text-zinc-600">
                  <div>類型：{m.content_type}</div>
                  <div>可見度：{m.visibility}</div>
                  <div>上傳者：{getProfileDisplayName(m.uploader) || "未知使用者"}</div>
                  <div>編輯者：{getProfileDisplayName(m.editor) || getProfileDisplayName(m.uploader) || "未知使用者"}</div>
                  <div>上傳時間：{formatDateTime(m.created_at)}</div>
                  <div>最後編輯：{formatDateTime(m.updated_at)}</div>
                </div>

                <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  {m.file_name ? (
                    <div>
                      <div className="break-all">{m.file_name}</div>
                      {typeof m.file_size === "number" ? <div className="mt-1">{formatBytes(m.file_size)}</div> : null}
                    </div>
                  ) : (
                    "-"
                  )}
                </div>

                {canManage ? (
                  <div className="mt-3 flex gap-2">
                    <Link href={`/training/edit?id=${m.id}`} className="inline-flex h-9 items-center justify-center rounded border px-3 text-xs hover:bg-zinc-50">
                      編輯
                    </Link>
                    <button
                      type="button"
                      onClick={() => onDelete(m.id)}
                      disabled={deletingId === m.id}
                      className="inline-flex h-9 items-center justify-center rounded border border-red-300 px-3 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      {deletingId === m.id ? "刪除中" : "刪除"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="mt-4 hidden overflow-x-auto rounded-lg border md:block">
          <div className="min-w-[760px]">
          <div className="grid grid-cols-12 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
            {canManage ? <div className="col-span-1">選取</div> : null}
            <div className={canManage ? "col-span-4" : "col-span-6"}>標題</div>
            <div className={canManage ? "col-span-1" : "col-span-2"}>類型</div>
            <div className={canManage ? "col-span-1" : "col-span-2"}>可見度</div>
            <div className={canManage ? "col-span-3" : "col-span-2"}>檔案</div>
            {canManage ? <div className="col-span-2 text-right">管理</div> : null}
          </div>
          <div className="divide-y">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-sm text-zinc-600">目前沒有資料</div>
            ) : (
              items.map((m) => (
                <div key={m.id} className="grid grid-cols-12 items-center px-3 py-3 text-sm">
                  {canManage ? (
                    <div className="col-span-1">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(m.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            if (e.target.checked) return Array.from(new Set([...prev, m.id]));
                            return prev.filter((x) => x !== m.id);
                          });
                        }}
                      />
                    </div>
                  ) : null}
                  <div className={canManage ? "col-span-4" : "col-span-6"}>
                    <Link href={`/training/detail?id=${m.id}`} className="font-medium hover:underline">
                      {m.title}
                    </Link>
                    {m.description ? <div className="mt-1 text-xs text-zinc-600 line-clamp-2">{m.description}</div> : null}
                    <div className="mt-1 text-xs text-zinc-500">上傳者：{getProfileDisplayName(m.uploader) || "未知使用者"}</div>
                    <div className="mt-1 text-xs text-zinc-500">編輯者：{getProfileDisplayName(m.editor) || getProfileDisplayName(m.uploader) || "未知使用者"}</div>
                    <div className="mt-1 text-xs text-zinc-500">上傳時間：{formatDateTime(m.created_at)}</div>
                    <div className="mt-1 text-xs text-zinc-500">最後編輯：{formatDateTime(m.updated_at)}</div>
                  </div>
                  <div className={canManage ? "col-span-1 text-zinc-700" : "col-span-2 text-zinc-700"}>{m.content_type}</div>
                  <div className={canManage ? "col-span-1 text-zinc-700" : "col-span-2 text-zinc-700"}>{m.visibility}</div>
                  <div className={canManage ? "col-span-3 text-xs text-zinc-600" : "col-span-2 text-right text-xs text-zinc-600"}>
                    {m.file_name ? (
                      <div>
                        <div className="break-all">{m.file_name}</div>
                        {typeof m.file_size === "number" ? <div>{formatBytes(m.file_size)}</div> : null}
                      </div>
                    ) : (
                      "-"
                    )}
                  </div>
                  {canManage ? (
                    <div className="col-span-2 flex justify-end gap-2 text-xs">
                      <Link
                        href={`/training/edit?id=${m.id}`}
                        className="whitespace-nowrap rounded border px-2 py-1 hover:bg-zinc-50"
                      >
                        編輯
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDelete(m.id)}
                        disabled={deletingId === m.id}
                        className="whitespace-nowrap rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        {deletingId === m.id ? "刪除中" : "刪除"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          </div>
        </div>
      </section>
      ) : null}

      {mode === "upload" ? (
        canUpload ? (
          <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">上傳教材</h2>

          <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            連線 Supabase：{(process.env.NEXT_PUBLIC_SUPABASE_URL || "(未設定)").replace(/https?:\/\//, "").split(".")[0]}
          </div>

          <form onSubmit={onUpload} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">標題</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 h-11 w-full rounded-lg border px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
                />
              </div>
              <div>
                <label className="text-sm font-medium">類型</label>
                <select
                  value={uploadContentType}
                  onChange={(e) => setUploadContentType(e.target.value as (typeof CONTENT_TYPES)[number])}
                  className="mt-1 h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
                >
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900/10"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">關鍵字</label>
                {keywordTags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {keywordTags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-2 rounded-full bg-zinc-200 px-3 py-1 text-sm">
                        <span>{t}</span>
                        <button
                          type="button"
                          onClick={() => setKeywordTags((prev) => prev.filter((x) => x !== t))}
                          className="text-zinc-700 hover:text-zinc-900"
                          aria-label="remove"
                        >
                          ×
                        </button>
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
                <div className="mt-2 text-xs text-zinc-600">按 Enter 會新增一個關鍵字標籤，可重複輸入新增多個。</div>
              </div>
              <div>
                <label className="text-sm font-medium">可見度</label>
                <select
                  value={uploadVisibility}
                  onChange={(e) => setUploadVisibility(e.target.value as (typeof VISIBILITIES)[number])}
                  className="mt-1 h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
                >
                  {VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {uploadVisibility === "department" ? (
              <div>
                <div className="text-sm font-medium">部門</div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {departments.map((d) => {
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
                {selectedDepartmentNames ? (
                  <div className="mt-2 text-xs text-zinc-600">已選：{selectedDepartmentNames}</div>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="text-sm font-medium">檔案</label>

              <div className="mt-1 text-xs text-zinc-600">上傳者：{currentUploaderName || "未知使用者"}</div>

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".mp4,.mov,.png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFile(f);
                  setUploadError(null);
                }}
              />

              <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-11 items-center justify-center rounded-lg border bg-white px-4 text-sm font-medium hover:bg-zinc-50"
                >
                  選擇檔案
                </button>
                <div className="text-sm text-zinc-700">
                  {file ? file.name : "尚未選擇任何檔案"}
                </div>
              </div>

              <div className="mt-2 text-xs text-zinc-600">
                支援：mp4/mov (≤2GB) 、png/jpg/jpeg/webp (≤10MB) 、pdf (≤50MB) 、docx/xlsx/pptx (≤50MB) 、txt
              </div>
            </div>

            {uploadError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-wrap">
                {uploadError}
              </div>
            ) : null}

            {uploadStep ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                ⏳ {uploadStep}
              </div>
            ) : null}

            {typeof uploadProgress === "number" ? (
              <div className="rounded-lg border bg-white px-3 py-3">
                <div className="flex items-center justify-between text-xs text-zinc-600">
                  <div>上傳進度</div>
                  <div>{uploadProgress}%</div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
                  <div className="h-2 bg-zinc-900" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            ) : null}

            {uploadOk ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <div>上傳成功</div>
                <div className="mt-1 font-mono text-xs text-emerald-700">ID: {uploadOk}</div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={uploading}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {uploading ? "上傳中..." : "建立並上傳"}
            </button>
          </form>
        </section>
        ) : (
          <section className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold">上傳教材</h2>
            <p className="mt-2 text-sm text-zinc-600">你目前沒有上傳權限。</p>
          </section>
        )
      ) : null}
    </div>
  );
}
