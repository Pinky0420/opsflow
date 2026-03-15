"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type AccessLevel = "viewer" | "manager" | "admin";
type AccessStatus = "active" | "disabled";

type AccessItem = {
  id: string;
  email: string;
  display_name: string | null;
  access_level: AccessLevel;
  status: AccessStatus;
  created_at: string;
  updated_at: string;
  profile: {
    account_id: string | null;
    display_name: string | null;
    role: string;
    status: string;
  } | null;
};

type Props = {
  initialItems: AccessItem[];
};

const accessLevelLabel: Record<AccessLevel, string> = {
  viewer: "Viewer",
  manager: "Manager",
  admin: "Admin",
};

function errorMessage(code: string) {
  if (code.startsWith("save_failed:")) return `儲存失敗：${code.replace("save_failed:", "")}`;
  if (code.startsWith("query_failed:")) return `讀取失敗：${code.replace("query_failed:", "")}`;
  if (code.startsWith("delete_failed:")) return `刪除失敗：${code.replace("delete_failed:", "")}`;
  if (code.startsWith("set_password_failed:")) return `設定密碼失敗：${code.replace("set_password_failed:", "")}`;
  if (code === "weak_password") return "密碼至少需要 8 個字元";
  if (code === "missing_email") return "請輸入 Email。";
  if (code === "forbidden") return "你沒有權限執行這個操作。";
  if (code === "unauthorized") return "登入狀態已失效，請重新登入。";
  if (code === "create_failed") return "新增失敗。";
  if (code === "update_failed") return "更新失敗。";
  return code;
}

export default function AccessManagementClient({ initialItems }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.email.localeCompare(b.email)),
    [items]
  );

  async function createAccess(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          display_name: displayName || null,
          access_level: accessLevel,
        }),
        auth: true,
      });

      const payload = (await response.json()) as { error?: string; item?: AccessItem };
      if (!response.ok || !payload.item) {
        setError(errorMessage(payload.error ?? "create_failed"));
        return;
      }

      setItems((prev) => [payload.item!, ...prev.filter((item) => item.id !== payload.item!.id)]);
      setEmail("");
      setDisplayName("");
      setAccessLevel("viewer");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create_failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function setPassword(id: string) {
    const item = items.find((x) => x.id === id);
    if (!item) return;

    const password = window.prompt(`替 ${item.email} 設定密碼（至少 8 碼）：`);
    if (!password) return;

    if (password.length < 8) {
      setError(errorMessage("weak_password"));
      return;
    }

    setSavingId(id);
    setError(null);

    try {
      const response = await apiFetch(`/api/admin/access/${id}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        auth: true,
      });

      const payload = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok) {
        setError(errorMessage(payload.error ? `set_password_failed:${payload.error}` : "set_password_failed"));
        return;
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "set_password_failed");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteAccess(id: string) {
    const item = items.find((x) => x.id === id);
    if (!item) return;

    const ok = window.confirm(`確定要刪除允許帳號：${item.email} ？`);
    if (!ok) return;

    setSavingId(id);
    setError(null);

    try {
      const response = await apiFetch(`/api/admin/access/${id}`, { method: "DELETE", auth: true });
      const payload = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok) {
        setError(errorMessage(payload.error ?? "delete_failed"));
        return;
      }

      setItems((prev) => prev.filter((x) => x.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete_failed");
    } finally {
      setSavingId(null);
    }
  }

  async function updateAccess(id: string, patch: Partial<Pick<AccessItem, "display_name" | "access_level" | "status">>) {
    setSavingId(id);
    setError(null);

    try {
      const response = await apiFetch(`/api/admin/access/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        auth: true,
      });

      const payload = (await response.json()) as { error?: string; item?: AccessItem };
      if (!response.ok || !payload.item) {
        setError(errorMessage(payload.error ?? "update_failed"));
        return;
      }

      setItems((prev) => prev.map((item) => (item.id === id ? payload.item! : item)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update_failed");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">權限管理</h1>
          <p className="mt-1 text-sm text-zinc-600">只有最高權限可管理允許登入的 email、名稱與權限層級。</p>
        </div>
      </div>

      <form onSubmit={createAccess} className="mt-6 grid grid-cols-1 gap-3 rounded-xl border bg-zinc-50 p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            placeholder="test_000@local.test"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">名稱</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
            placeholder="測試者"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">權限</label>
          <select
            value={accessLevel}
            onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
            className="h-11 w-full rounded-lg border bg-white px-3 outline-none focus:ring-2 focus:ring-zinc-900/10"
          >
            <option value="viewer">Viewer</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="md:col-span-4">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {submitting ? "新增中..." : "新增允許帳號"}
          </button>
        </div>
      </form>

      {error ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="mt-6 space-y-3">
        {sortedItems.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">目前還沒有允許登入的帳號</div>
        ) : (
          sortedItems.map((item) => (
            <div key={item.id} className="rounded-xl border p-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_180px_140px]">
                <div>
                  <div className="text-sm font-semibold">{item.display_name || item.profile?.display_name || "未命名"}</div>
                  <div className="mt-1 break-all text-sm text-zinc-600">{item.email}</div>
                  <div className="mt-2 text-xs text-zinc-500">
                    {item.profile ? `已建立帳號${item.profile.account_id ? ` / ${item.profile.account_id}` : ""}` : "尚未完成註冊"}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">名稱</label>
                  <input
                    type="text"
                    defaultValue={item.display_name ?? ""}
                    onBlur={(e) => {
                      const value = e.target.value.trim() || null;
                      if (value !== (item.display_name ?? null)) {
                        void updateAccess(item.id, { display_name: value });
                      }
                    }}
                    className="h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">權限層級</label>
                  <select
                    value={item.access_level}
                    onChange={(e) => void updateAccess(item.id, { access_level: e.target.value as AccessLevel })}
                    className="h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <div className="mt-1 text-xs text-zinc-500">目前：{accessLevelLabel[item.access_level]}</div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">狀態</label>
                  <button
                    type="button"
                    onClick={() => void updateAccess(item.id, { status: item.status === "active" ? "disabled" : "active" })}
                    className={`inline-flex h-10 w-full items-center justify-center rounded-lg border px-3 text-sm font-medium ${item.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-100 text-zinc-600"}`}
                  >
                    {item.status === "active" ? "已啟用" : "已停用"}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
                <div>{savingId === item.id ? "處理中..." : `更新時間：${new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.updated_at))}`}</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  {item.access_level !== "viewer" ? (
                    <button
                      type="button"
                      onClick={() => void setPassword(item.id)}
                      disabled={savingId === item.id}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                    >
                      設定密碼
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void deleteAccess(item.id)}
                    disabled={savingId === item.id}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
