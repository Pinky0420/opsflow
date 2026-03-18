"use client";

import { useMemo, useRef, useState } from "react";
import { collection, query, where, orderBy, limit, getDocs, addDoc } from "firebase/firestore";
import { db, firebaseAuth } from "@/lib/firebase/client";

type Reply = {
  id: string;
  reply_text: string;
  replied_at: string;
  created_at: string;
};

type SourceType = "department_info" | "decisions" | "todos";

type SpeechRecognitionType = typeof window & {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
};

type Props = {
  sourceType: SourceType;
  sourceItemId: string;
  canReply: boolean;
};

export default function VoiceReplyBox({ sourceType, sourceItemId, canReply }: Props) {
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Reply[]>([]);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const hasSpeechRecognition = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as SpeechRecognitionType;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  async function refresh() {
    if (!canReply) return;
    setError(null);
    try {
        const snap = await getDocs(query(
        collection(db, "replies"),
        where("source_type", "==", sourceType),
        where("source_item_id", "==", sourceItemId),
        orderBy("replied_at", "desc"),
        limit(20)
      ));
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Reply)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch_failed");
    }
  }

  function stop() {
    try {
      recognitionRef.current?.stop?.();
    } catch {
    }
    recognitionRef.current = null;
    setListening(false);
  }

  function start() {
    if (!hasSpeechRecognition || !canReply) return;

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
      setDraft((prev) => (prev ? prev + " " : "") + transcript.trim());
    };

    recognition.onerror = () => {
      setError("speech_error");
      stop();
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    setError(null);

    try {
      recognition.start();
    } catch {
      setError("speech_start_failed");
      stop();
    }
  }

  async function submit() {
    if (!canReply) return;

    const reply_text = draft.trim();
    if (!reply_text) {
      setError("missing_reply_text");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("unauthorized");
      await addDoc(collection(db, "replies"), {
        source_type: sourceType, source_item_id: sourceItemId, reply_text,
        replied_by: user.uid,
        replied_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      setDraft("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border bg-zinc-50 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-zinc-700">老闆回覆（語音轉文字）</div>
        {hasSpeechRecognition ? (
          <button
            type="button"
            onClick={() => (listening ? stop() : start())}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              listening ? "bg-red-600 text-white" : "bg-zinc-900 text-white"
            }`}
            disabled={!canReply}
          >
            {listening ? "停止" : "開始講"}
          </button>
        ) : (
          <div className="text-xs text-zinc-500">此瀏覽器不支援語音辨識</div>
        )}
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
        rows={3}
        placeholder="你可以直接講話或手動修改文字..."
        disabled={!canReply}
      />

      {error ? (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : null}

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={submit}
          disabled={loading || !canReply}
          className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {loading ? "儲存中..." : "送出"}
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refresh}
            className="text-xs text-zinc-600 hover:underline"
            disabled={!canReply}
          >
            重新整理
          </button>
          <button
            type="button"
            onClick={() => setDraft("")}
            className="text-xs text-zinc-600 hover:underline"
            disabled={!canReply}
          >
            清空
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-zinc-700">歷史回覆</div>
          {items.map((r) => (
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
