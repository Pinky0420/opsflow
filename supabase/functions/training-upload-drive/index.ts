import { corsHeaders } from "../_shared/cors.ts";
import { createSupabaseAdminClient, createSupabaseUserClient } from "../_shared/supabase.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

async function getGoogleAccessToken(): Promise<string> {
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") as string | undefined;
  const rawKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") as string | undefined;
  if (!email || !rawKey) throw new Error("Google Service Account credentials not configured");

  const privateKeyPem = rawKey.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const encodeB64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const header = encodeB64url({ alg: "RS256", typ: "JWT" });
  const payload = encodeB64url({
    iss: email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  });
  const signingInput = `${header}.${payload}`;

  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(signingInput),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Google auth failed: ${tokenData.error ?? JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

async function uploadToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  mimeType: string,
  fileBytes: Uint8Array,
): Promise<string> {
  const metadata = { name: fileName, parents: [folderId] };
  const boundary = "boundary_opsflow_" + Math.random().toString(36).slice(2);

  const encoder = new TextEncoder();
  const metaPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
  );
  const filePart = encoder.encode(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const ending = encoder.encode(`\r\n--${boundary}--`);

  const totalLength = metaPart.length + filePart.length + fileBytes.length + ending.length;
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of [metaPart, filePart, fileBytes, ending]) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const uploadData = await uploadRes.json() as { id?: string; error?: unknown };
  if (!uploadRes.ok || !uploadData.id) {
    throw new Error(`Drive upload failed: ${JSON.stringify(uploadData.error ?? uploadData)}`);
  }
  return uploadData.id;
}

async function setPublicPermission(accessToken: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  try {
    const userClient = createSupabaseUserClient(token);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? null;
    if (role !== "admin" && role !== "boss" && role !== "uploader") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const folderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID") as string | undefined;
    if (!folderId) {
      return new Response(JSON.stringify({ error: "drive_not_configured" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_form_data" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const file = formData.get("file") as File | null;
    const metaRaw = formData.get("meta") as string | null;
    if (!file || !metaRaw) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let meta: {
      title: string;
      description?: string;
      content_type: string;
      visibility: string;
      keywords: string;
      departments?: string[];
    };
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return new Response(JSON.stringify({ error: "invalid_meta" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (!meta.title?.trim()) {
      return new Response(JSON.stringify({ error: "missing_title" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const admin = createSupabaseAdminClient();

    const { data: material, error: insertError } = await admin
      .from("training_materials")
      .insert({
        title: meta.title.trim(),
        description: meta.description?.trim() || null,
        content_type: meta.content_type,
        visibility: meta.visibility,
        keywords: meta.keywords || "",
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
        uploaded_by: user.id,
        status: "active",
      })
      .select("id")
      .single();

    if (insertError || !material) {
      return new Response(
        JSON.stringify({ error: `create_failed: ${insertError?.message ?? "no data"}` }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    const materialId = material.id as string;

    const deptIds = meta.visibility === "department" ? (meta.departments ?? []) : [];
    if (deptIds.length > 0) {
      await admin.from("training_material_departments").insert(
        deptIds.map((department_id: string) => ({ material_id: materialId, department_id })),
      );
    }

    const accessToken = await getGoogleAccessToken();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const driveFileName = `${materialId}_${file.name}`;
    const driveFileId = await uploadToDrive(
      accessToken,
      folderId,
      driveFileName,
      file.type || "application/octet-stream",
      fileBytes,
    );

    await setPublicPermission(accessToken, driveFileId);

    await admin.from("training_materials").update({
      file_path: driveFileId,
      file_bucket: "google-drive",
      updated_by: user.id,
    }).eq("id", materialId);

    return new Response(JSON.stringify({ id: materialId, driveFileId }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
