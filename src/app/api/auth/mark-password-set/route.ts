import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isMissingPasswordSetColumn(message: string) {
  return message.includes("Could not find the 'password_set' column") || message.toLowerCase().includes("password_set");
}

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("profiles").update({ password_set: true }).eq("id", user.id);

  if (error) {
    if (isMissingPasswordSetColumn(error.message)) {
      return NextResponse.json({ ok: true, warning: "missing_password_set_column" });
    }

    return NextResponse.json({ error: `mark_password_failed:${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
