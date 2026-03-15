import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CreateReplyBody = {
  source_type: "department_info" | "decisions" | "todos";
  source_item_id: string;
  reply_text: string;
  audio_ext?: "webm" | "wav" | "mp3";
};

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "boss" && profile.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const source_type = url.searchParams.get("source_type") as CreateReplyBody["source_type"] | null;
  const source_item_id = url.searchParams.get("source_item_id");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitRaw ?? 20) || 20, 1), 100);

  if (!source_type || !source_item_id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("replies")
    .select("id, source_type, source_item_id, reply_text, replied_at, replied_by, created_at")
    .eq("source_type", source_type)
    .eq("source_item_id", source_item_id)
    .order("replied_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "boss" && profile.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: CreateReplyBody;
  try {
    body = (await request.json()) as CreateReplyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.source_type || !body.source_item_id || !body.reply_text) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const ext = body.audio_ext ?? "webm";
  const replyId = crypto.randomUUID();
  const audioPath = `${replyId}.${ext}`;

  const { data: reply, error } = await supabase
    .from("replies")
    .insert({
      id: replyId,
      source_type: body.source_type,
      source_item_id: body.source_item_id,
      reply_text: body.reply_text,
      audio_bucket: "reply-audio",
      audio_path: audioPath,
      replied_by: user.id,
    })
    .select("id, audio_bucket, audio_path")
    .single();

  if (error || !reply) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json(reply);
}
