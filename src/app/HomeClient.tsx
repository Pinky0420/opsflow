"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, query, where, orderBy, limit, getDocs, addDoc } from "firebase/firestore";
import { db, firebaseAuth } from "@/lib/firebase/client";

type Department = {
  id: string;
  name: string;
};

type HomeItem = {
  id: string;
  title: string;
  detail?: string;
};

type Reply = {
  id: string;
  source_type: "department_info" | "decisions" | "todos";
  source_item_id: string;
  reply_text: string;
  replied_at: string;
  created_at: string;
};

type Props = {
  role: string | null;
  departments: Department[];
  decisions: HomeItem[];
  todos: HomeItem[];
};

type SpeechRecognitionType = typeof window & {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
};

function isBossOrAdmin(role: string | null) {
  return role === "boss" || role === "admin";
}

export default function HomeClient({ role, departments, decisions, todos }: Props) {
  const canReply = isBossOrAdmin(role);

  const [draftByKey, setDraftByKey] = useState<Record<string, string>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorByKey, setErrorByKey] = useState<Record<string, string | null>>({});
  const [repliesByKey, setRepliesByKey] = useState<Record<string, Reply[]>>({});

  const recognitionRef = useRef<any>(null);
  const [listeningKey, setListeningKey] = useState<string | null>(null);

  const hasSpeechRecognition = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as SpeechRecognitionType;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  function keyOf(sourceType: Reply["source_type"], itemId: string) {
    return `${sourceType}:${itemId}`;
  }

  async function loadReplies(source_type: Reply["source_type"], source_item_id: string) {
    if (!canReply) return;
    const k = keyOf(source_type, source_item_id);
    try {
      const snap = await getDocs(query(
        collection(db, "replies"),
        where("source_type", "==", source_type),
        where("source_item_id", "==", source_item_id),
        orderBy("replied_at", "desc"),
        limit(20)
      ));
      setRepliesByKey((prev) => ({ ...prev, [k]: snap.docs.map((d) => ({ id: d.id, ...d.data() } as Reply)) }));
    } catch (e) {
      setErrorByKey((prev) => ({ ...prev, [k]: e instanceof Error ? e.message : "fetch_failed" }));
    }
  }

  useEffect(() => {
    if (!canReply) return;
    const jobs: Array<Promise<void>> = [];
    for (const d of decisions) jobs.push(loadReplies("decisions", d.id));
    for (const t of todos) jobs.push(loadReplies("todos", t.id));
    void Promise.all(jobs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReply]);

  function stopListening() {
    try {
      recognitionRef.current?.stop?.();
    } catch {
    }
    recognitionRef.current = null;
    setListeningKey(null);
  }

  function startListening(sourceType: Reply["source_type"], itemId: string) {
    if (!hasSpeechRecognition) return;
    if (!canReply) return;

    const k = keyOf(sourceType, itemId);

    if (listeningKey && listeningKey !== k) {
      stopListening();
    }

    const w = window as unknown as SpeechRecognitionType;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "zh-TW";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setDraftByKey((prev) => ({ ...prev, [k]: (prev[k] ? prev[k] + " " : "") + transcript.trim() }));
    };

    recognition.onerror = () => {
      setErrorByKey((prev) => ({ ...prev, [k]: "speech_error" }));
      stopListening();
    };

    recognition.onend = () => {
      setListeningKey((cur) => (cur === k ? null : cur));
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListeningKey(k);
    setErrorByKey((prev) => ({ ...prev, [k]: null }));

    try {
      recognition.start();
    } catch {
      setErrorByKey((prev) => ({ ...prev, [k]: "speech_start_failed" }));
      stopListening();
    }
  }

  async function submitReply(source_type: Reply["source_type"], source_item_id: string) {
    if (!canReply) return;

    const k = keyOf(source_type, source_item_id);
    const reply_text = (draftByKey[k] ?? "").trim();

    if (!reply_text) {
      setErrorByKey((prev) => ({ ...prev, [k]: "missing_reply_text" }));
      return;
    }

    setLoadingKey(k);
    setErrorByKey((prev) => ({ ...prev, [k]: null }));
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("unauthorized");
      await addDoc(collection(db, "replies"), {
        source_type, source_item_id, reply_text,
        replied_by: user.uid,
        replied_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      setDraftByKey((prev) => ({ ...prev, [k]: "" }));
      await loadReplies(source_type, source_item_id);
    } catch (e) {
      setErrorByKey((prev) => ({ ...prev, [k]: e instanceof Error ? e.message : "save_failed" }));
    } finally {
      setLoadingKey(null);
    }
  }

  function renderReplyBox(sourceType: Reply["source_type"], item: HomeItem) {
    const k = keyOf(sourceType, item.id);
    const listening = listeningKey === k;
    const loading = loadingKey === k;
    const replies = repliesByKey[k] ?? [];
    const err = errorByKey[k];

    return (
      <div className="mt-4 rounded-lg border bg-zinc-50 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-zinc-700">老闆回覆（語音轉文字）</div>
          {hasSpeechRecognition ? (
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening(sourceType, item.id))}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                listening ? "bg-red-600 text-white" : "bg-zinc-900 text-white"
              }`}
            >
              {listening ? "停止" : "開始講"}
            </button>
          ) : (
            <div className="text-xs text-zinc-500">此瀏覽器不支援語音辨識</div>
          )}
        </div>

        <textarea
          value={draftByKey[k] ?? ""}
          onChange={(e) => setDraftByKey((prev) => ({ ...prev, [k]: e.target.value }))}
          className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
          rows={3}
          placeholder="你可以直接講話或手動修改文字..."
          disabled={!canReply}
        />

        {err ? (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
        ) : null}

        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => submitReply(sourceType, item.id)}
            disabled={loading || !canReply}
            className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? "儲存中..." : "送出"}
          </button>
          <button
            type="button"
            onClick={() => setDraftByKey((prev) => ({ ...prev, [k]: "" }))}
            className="text-xs text-zinc-600 hover:underline"
            disabled={!canReply}
          >
            清空
          </button>
        </div>

        {replies.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="text-xs font-medium text-zinc-700">歷史回覆</div>
            {replies.map((r) => (
              <div key={r.id} className="rounded-lg border bg-white px-3 py-2">
                <div className="whitespace-pre-wrap text-sm text-zinc-800">{r.reply_text}</div>
                <div className="mt-1 text-xs text-zinc-500">{new Date(r.replied_at || r.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-500">尚無回覆</div>
        )}
      </div>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold">各部門資訊</h2>
        <p className="mt-2 text-sm text-zinc-600">部門清單（先從資料庫讀取）</p>
        <div className="mt-4 space-y-2">
          {departments.length === 0 ? (
            <div className="text-sm text-zinc-600">尚未建立部門</div>
          ) : (
            departments.map((d) => (
              <div key={d.id} className="rounded-lg border bg-zinc-50 px-3 py-2 text-sm">
                {d.name}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold">待決策</h2>
        <p className="mt-2 text-sm text-zinc-600">需要主管核准的事項（先用 Mock）</p>

        <div className="mt-4 space-y-4">
          {decisions.map((it) => (
            <div key={it.id} className="rounded-lg border px-3 py-3">
              <div className="text-sm font-medium">{it.title}</div>
              {it.detail ? <div className="mt-1 text-xs text-zinc-600">{it.detail}</div> : null}
              {canReply ? renderReplyBox("decisions", it) : <div className="mt-3 text-xs text-zinc-500">只有 boss/admin 可回覆</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold">待執行</h2>
        <p className="mt-2 text-sm text-zinc-600">已決策、待執行工作（先用 Mock）</p>

        <div className="mt-4 space-y-4">
          {todos.map((it) => (
            <div key={it.id} className="rounded-lg border px-3 py-3">
              <div className="text-sm font-medium">{it.title}</div>
              {it.detail ? <div className="mt-1 text-xs text-zinc-600">{it.detail}</div> : null}
              {canReply ? renderReplyBox("todos", it) : <div className="mt-3 text-xs text-zinc-500">只有 boss/admin 可回覆</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
