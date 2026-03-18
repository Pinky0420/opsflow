"use client";

import { useEffect, useState } from "react";
import AppHeader from "../_components/AppHeader";
import { useSession } from "@/lib/useSession";
import {
  collection, query, orderBy, getDocs, addDoc, updateDoc, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";

type DerexCard = {
  id: string;
  message_id: string;
  status: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  card_title: string;
  card_detail: string;
  boss_reply: string;
  dept_tags: string[];
  department: string;
  media_url: string[];
  update_at: string;
  created_at: string;
  finish_time?: string;
  source: string;
  notion_page_id?: string;
};

const DEPARTMENTS = ["商品管理", "行政管理", "行銷企劃", "展覽活動", "社群媒體", "設計部門", "業務開發"];

const PRIORITY_CONFIG: Record<number, { label: string; dot: string; border: string; badge: string }> = {
  1: { label: "一般", dot: "bg-zinc-400", border: "border-zinc-200", badge: "bg-zinc-100 text-zinc-600" },
  2: { label: "留意", dot: "bg-blue-400", border: "border-blue-100", badge: "bg-blue-50 text-blue-700" },
  3: { label: "注意", dot: "bg-yellow-400", border: "border-yellow-200", badge: "bg-yellow-50 text-yellow-700" },
  4: { label: "重要", dot: "bg-orange-500", border: "border-orange-200", badge: "bg-orange-50 text-orange-700" },
  5: { label: "緊急", dot: "bg-red-500 animate-pulse", border: "border-red-200", badge: "bg-red-50 text-red-700" },
};

function makeMsgId(dept: string) {
  return `MSG-${dept.slice(0, 2)}-${Date.now().toString(36).toUpperCase()}`;
}

const MOCK_CARDS: Omit<DerexCard, "id">[] = [
  {
    message_id: makeMsgId("設計"),
    status: false,
    priority: 5,
    card_title: "設計部：噴繪樣版已變更，請確認",
    card_detail: `**背景概要：**\n• 設計部門於 2026/03/17 提交新版噴繪樣版（v3.2），修改了主視覺字體與色票。\n• 本次變更影響本月所有對外展覽活動的輸出物料，共 12 件。\n• 現有庫存舊版物料 8 件仍待處理，需確認是否報廢或沿用。\n\n**特助建議：**\n1. 請於今日 18:00 前確認新版樣版，避免明日印刷作業延誤（工廠截止時間）。\n2. 舊版物料建議以「展覽備品」名義保留，待確認後再決定去留。\n\n**原始參照：** Notion 設計部週報 #2026-W11｜連絡人：阿珮`,
    boss_reply: "",
    dept_tags: ["設計部門", "展覽活動"],
    department: "設計部門",
    media_url: [
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80",
      "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=600&q=80",
    ],
    update_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    source: "mock",
  },
  {
    message_id: makeMsgId("商品"),
    status: false,
    priority: 4,
    card_title: "商品部：週邊SOP備貨量請決策",
    card_detail: `**背景概要：**\n• 商品部統計 Q2 週邊商品預購數量達 340 件，超出原訂備貨量（200 件）70%。\n• 現有倉儲空間估計可容納上限為 280 件，差額 60 件需另行租用空間或提前出貨。\n• 供應商報價有效期至 3/22，超過後單價將上漲 8%。\n\n**特助建議：**\n1. 建議追加備貨至 350 件（含 buffer 10 件），在報價有效期內完成下單。\n2. 聯繫倉儲評估臨時空間費用，與追加採購成本比較後再決策。\n\n**原始參照：** 商品管理 Notion #週邊SOP訂購紀錄｜截止日：2026/03/22`,
    boss_reply: "",
    dept_tags: ["商品管理"],
    department: "商品管理",
    media_url: [],
    update_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    source: "mock",
  },
  {
    message_id: makeMsgId("行銷"),
    status: false,
    priority: 3,
    card_title: "行銷：三月活動預算使用率 68%",
    card_detail: `**背景概要：**\n• 三月行銷預算總額 NT$120,000，目前已使用 NT$81,600（68%），剩餘 NT$38,400。\n• 本月尚有 2 場社群廣告投放未執行（預計耗用 NT$35,000），預算剛好覆蓋。\n• 若加計突發展覽宣傳需求，預算可能不足。\n\n**特助建議：**\n1. 預算狀況正常，照計劃執行即可。\n2. 若四月有大型活動，建議本週提交預算申請以利審核。\n\n**原始參照：** 行銷企劃 Notion 三月份行動計劃`,
    boss_reply: "",
    dept_tags: ["行銷企劃"],
    department: "行銷企劃",
    media_url: [],
    update_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    source: "mock",
  },
  {
    message_id: makeMsgId("展覽"),
    status: false,
    priority: 2,
    card_title: "展覽活動：4月場地確認，待簽約",
    card_detail: `**背景概要：**\n• 四月展覽（4/12–4/14）場地已完成口頭確認，場地方等待簽約文件。\n• 合約審查已由行政完成，無重大疑義。\n• 訂金 NT$30,000 需於 3/25 前匯款。\n\n**特助建議：**\n1. 請於本週指示行政部門完成簽約，避免場地遭他人搶訂。\n2. 確認財務已備妥訂金。\n\n**原始參照：** 展覽活動 Notion #四月場地確認`,
    boss_reply: "",
    dept_tags: ["展覽活動", "行政管理"],
    department: "展覽活動",
    media_url: ["https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&q=80"],
    update_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    source: "mock",
  },
  {
    message_id: makeMsgId("社群"),
    status: true,
    priority: 3,
    card_title: "社群：三月IG發文排程已確認",
    card_detail: `**背景概要：**\n• 三月 IG 內容排程（12 篇）已獲老闆確認，設計稿全數完成。\n• 預計每週二、四、六各發一篇。\n• 無需追加操作。\n\n**特助建議：**\n照計劃執行。\n\n**原始參照：** 社群媒體 Notion 三月排程確認單`,
    boss_reply: "好的，照計劃走，四月排程下週給我看。",
    dept_tags: ["社群媒體"],
    department: "社群媒體",
    media_url: [],
    update_at: new Date(Date.now() - 86400000).toISOString(),
    created_at: new Date(Date.now() - 86400000).toISOString(),
    finish_time: new Date(Date.now() - 86400000).toISOString(),
    source: "mock",
  },
];

function formatDetail(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("**") && line.endsWith("**")) {
      return <div key={i} className="mt-3 text-xs font-semibold text-zinc-500 first:mt-0">{line.replace(/\*\*/g, "")}</div>;
    }
    if (line.startsWith("• ")) {
      return <div key={i} className="mt-1 flex gap-2 text-sm text-zinc-700"><span className="mt-1 shrink-0 text-zinc-400">•</span><span>{line.slice(2)}</span></div>;
    }
    if (line.trim() === "") return null;
    return <div key={i} className="mt-1 text-sm text-zinc-700">{line}</div>;
  });
}

function PriorityDot({ priority }: { priority: number }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG[1];
  return (
    <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} title={cfg.label} />
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG[1];
  return (
    <span className={`inline-flex h-5 items-center rounded px-1.5 text-xs font-medium ${cfg.badge}`}>
      {cfg.label}
    </span>
  );
}

function DeptTag({ name }: { name: string }) {
  return (
    <span className="inline-flex h-5 items-center rounded bg-zinc-100 px-1.5 text-xs text-zinc-600">{name}</span>
  );
}

type CardProps = {
  card: DerexCard;
  onSubmitReply: (id: string, reply: string, deptTags: string[]) => Promise<void>;
};

function MediaPreview({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-zinc-500">附件媒體（{urls.length}）</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
            {url.match(/\.(mp4|mov|webm)$/i) ? (
              <div className="flex h-20 w-32 items-center justify-center text-zinc-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
            ) : (
              <img src={url} alt={`附件 ${i + 1}`} className="h-20 w-32 object-cover transition-opacity group-hover:opacity-80" />
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function DerexCardItem({ card, onSubmitReply }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState(card.boss_reply);
  const [selectedDepts, setSelectedDepts] = useState<string[]>(card.dept_tags);
  const [submitting, setSubmitting] = useState(false);
  const cfg = PRIORITY_CONFIG[card.priority] ?? PRIORITY_CONFIG[1];

  async function handleSubmit() {
    if (!reply.trim()) return;
    setSubmitting(true);
    await onSubmitReply(card.id, reply.trim(), selectedDepts);
    setSubmitting(false);
    setExpanded(false);
  }

  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-all ${cfg.border} ${card.status ? "opacity-60" : ""}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
      >
        <PriorityDot priority={card.priority} />
        <span className="w-20 shrink-0 truncate text-xs font-medium text-zinc-500">{card.department}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">{card.card_title}</span>
        <div className="ml-2 flex shrink-0 items-center gap-2">
          <PriorityBadge priority={card.priority} />
          {card.status && (
            <span className="inline-flex h-5 items-center rounded bg-green-100 px-1.5 text-xs font-medium text-green-700">已完成</span>
          )}
          <svg
            xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3">
          <div className="flex flex-wrap gap-1.5">
            {card.dept_tags.map((t) => <DeptTag key={t} name={t} />)}
          </div>

          <MediaPreview urls={card.media_url ?? []} />

          <div className="mt-3 rounded-lg bg-zinc-50 p-3">
            {formatDetail(card.card_detail)}
          </div>

          {card.status && card.boss_reply ? (
            <div className="mt-3 rounded-lg border border-green-100 bg-green-50 p-3">
              <div className="text-xs font-medium text-green-600">老闆回覆</div>
              <div className="mt-1 text-sm text-zinc-800">{card.boss_reply}</div>
            </div>
          ) : !card.status ? (
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-zinc-600">老闆回覆</label>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  placeholder="輸入你的決策或指示..."
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-600">通知部門（回寫 Notion 用）</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DEPARTMENTS.map((dept) => {
                    const checked = selectedDepts.includes(dept);
                    return (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setSelectedDepts((prev) =>
                          checked ? prev.filter((d) => d !== dept) : [...prev, dept]
                        )}
                        className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                          checked ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {dept}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || !reply.trim()}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {submitting ? "送出中..." : "確認送出"}
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-zinc-50"
                >
                  收合
                </button>
              </div>

              <p className="text-xs text-zinc-400">送出後將標記為已完成，並觸發 Notion 回寫（Phase 2）</p>
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between text-xs text-zinc-400">
            <span className="font-mono">{card.message_id}</span>
            <div className="flex items-center gap-2">
              {card.finish_time && (
                <span>完成：{new Date(card.finish_time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</span>
              )}
              {!card.finish_time && (
                <span>更新：{new Date(card.update_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</span>
              )}
              {card.source === "mock" && <span className="rounded bg-zinc-100 px-1">mock</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DerexPage() {
  const session = useSession({ redirectTo: "/derex", requiredRole: ["admin", "boss"] });
  const [cards, setCards] = useState<DerexCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  async function loadCards() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "derex_cards"), orderBy("created_at", "desc")));
      setCards(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DerexCard, "id">) })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session.status !== "ready") return;
    void loadCards();
  }, [session.status]);

  async function seedMockData() {
    setSeeding(true);
    try {
      await Promise.all(MOCK_CARDS.map((card) => addDoc(collection(db, "derex_cards"), card)));
      await loadCards();
    } finally {
      setSeeding(false);
    }
  }

  async function onSubmitReply(id: string, reply: string, deptTags: string[]) {
    const now = new Date().toISOString();
    await updateDoc(doc(db, "derex_cards", id), {
      boss_reply: reply,
      dept_tags: deptTags,
      status: true,
      update_at: now,
      finish_time: now,
    });
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, boss_reply: reply, dept_tags: deptTags, status: true, update_at: now, finish_time: now } : c
      )
    );
  }

  if (session.status !== "ready") return <div className="min-h-screen bg-zinc-50" />;

  const { profile } = session;
  const pending = cards.filter((c) => !c.status).sort((a, b) => b.priority - a.priority);
  const done = cards.filter((c) => c.status);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <AppHeader subtitle="DerexPage 決策中心" role={profile.role} />

      <main className="mx-auto w-full max-w-3xl space-y-6 px-3 py-4 sm:px-4 sm:py-6 md:pr-6 md:py-8" style={{ paddingLeft: "var(--app-sidebar-offset, 0px)" }}>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">DerexPage</h1>
            <p className="mt-0.5 text-xs text-zinc-500">各部門 Notion → AI 特助摘要 → 老闆決策</p>
          </div>
          <div className="flex items-center gap-2">
            {cards.length === 0 && !loading && (
              <button
                type="button"
                onClick={seedMockData}
                disabled={seeding}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-zinc-400 bg-white px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                {seeding ? "建立中..." : "載入 Mock 資料 (Demo)"}
              </button>
            )}
            <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs font-medium text-white">
              {pending.length} 待處理
            </span>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-zinc-500">載入中...</div>
        ) : cards.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white py-16 text-center">
            <div className="text-sm font-medium text-zinc-500">目前沒有任何決策卡片</div>
            <div className="mt-1 text-xs text-zinc-400">點擊上方「載入 Mock 資料」進行 Demo，或等待 Notion 同步</div>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">待處理（{pending.length}）</div>
                {pending.map((card) => (
                  <DerexCardItem key={card.id} card={card} onSubmitReply={onSubmitReply} />
                ))}
              </section>
            )}

            {done.length > 0 && (
              <section className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">已完成（{done.length}）</div>
                {done.map((card) => (
                  <DerexCardItem key={card.id} card={card} onSubmitReply={onSubmitReply} />
                ))}
              </section>
            )}
          </>
        )}

        <div className="rounded-xl border border-dashed bg-white p-4 text-xs text-zinc-400">
          <div className="font-medium text-zinc-500">Phase 2 預留（需要 API 權限）</div>
          <div className="mt-1 space-y-0.5">
            <div>• Notion API → 自動抓取各部門資料</div>
            <div>• Gemini API → AI 摘要生成 card_title / card_detail</div>
            <div>• Notion 回寫 → 老闆回覆附時間戳記推播至部門頁</div>
          </div>
        </div>
      </main>
    </div>
  );
}
