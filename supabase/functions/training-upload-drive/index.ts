import { corsHeaders } from "../_shared/cors.ts";

// deno-lint-ignore no-explicit-any
const Deno = (globalThis as any).Deno;

async function verifyFirebaseToken(idToken: string): Promise<string> {
  const webApiKey = Deno.env.get("FIREBASE_WEB_API_KEY") as string | undefined;
  if (!webApiKey) throw new Error("FIREBASE_WEB_API_KEY not configured");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${webApiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) },
  );
  const data = await res.json() as { users?: { localId: string }[]; error?: { message: string } };
  if (!res.ok || !data.users?.[0]?.localId) {
    throw new Error(data.error?.message ?? "invalid_token");
  }
  return data.users[0].localId;
}

function toFirestoreValue(v: unknown): unknown {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  return { stringValue: String(v) };
}

function toFirestoreDoc(data: Record<string, unknown>): { fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

function fromFirestoreDoc(doc: { fields?: Record<string, { stringValue?: string; integerValue?: string; booleanValue?: boolean; nullValue?: null }> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    if ("stringValue" in v) out[k] = v.stringValue;
    else if ("integerValue" in v) out[k] = Number(v.integerValue);
    else if ("booleanValue" in v) out[k] = v.booleanValue;
    else out[k] = null;
  }
  return out;
}

async function getServiceAccountToken(scopes: string): Promise<string> {
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") as string | undefined;
  const rawKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") as string | undefined;
  if (!email || !rawKey) throw new Error("Google Service Account credentials not configured");

  const privateKeyPem = rawKey.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const encodeB64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const header = encodeB64url({ alg: "RS256", typ: "JWT" });
  const payload = encodeB64url({ iss: email, scope: scopes, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now });
  const signingInput = `${header}.${payload}`;
  const pemBody = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryKey.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tokenData.access_token) throw new Error(`Google auth failed: ${tokenData.error ?? JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function firestoreGetDoc(token: string, projectId: string, docPath: string): Promise<Record<string, unknown> | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  const doc = await res.json() as { fields?: Record<string, unknown>; error?: { message: string } };
  if (!res.ok) throw new Error(doc.error?.message ?? "firestore_get_failed");
  return fromFirestoreDoc(doc as Parameters<typeof fromFirestoreDoc>[0]);
}

async function firestoreCreateDoc(token: string, projectId: string, collection: string, data: Record<string, unknown>): Promise<string> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(toFirestoreDoc(data)),
  });
  const doc = await res.json() as { name?: string; error?: { message: string } };
  if (!res.ok) throw new Error(doc.error?.message ?? "firestore_create_failed");
  return (doc.name ?? "").split("/").pop()!;
}

async function firestorePatchDoc(token: string, projectId: string, docPath: string, data: Record<string, unknown>): Promise<void> {
  const fields = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?${fields}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(toFirestoreDoc(data)),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: { message: string } };
    throw new Error(err.error?.message ?? "firestore_patch_failed");
  }
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
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID") as string | undefined;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "firebase_not_configured" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let uid: string;
    try {
      uid = await verifyFirebaseToken(token);
    } catch {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const serviceToken = await getServiceAccountToken(
      "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/datastore",
    );

    const userProfile = await firestoreGetDoc(serviceToken, projectId, `users/${uid}`);
    const role = (userProfile?.role as string | undefined) ?? null;
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

    const now = new Date().toISOString();
    const materialId = await firestoreCreateDoc(serviceToken, projectId, "training_materials", {
      title: meta.title.trim(),
      description: meta.description?.trim() || null,
      content_type: meta.content_type,
      visibility: meta.visibility,
      keywords: meta.keywords || "",
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      uploaded_by: uid,
      status: "active",
      file_path: "",
      file_bucket: "",
      created_at: now,
      updated_at: now,
    });

    const deptIds = meta.visibility === "department" ? (meta.departments ?? []) : [];
    if (deptIds.length > 0) {
      await Promise.all(
        deptIds.map((department_id: string) =>
          firestoreCreateDoc(serviceToken, projectId, "training_material_departments", {
            material_id: materialId,
            department_id,
          })
        ),
      );
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const driveFileName = `${materialId}_${file.name}`;
    const driveFileId = await uploadToDrive(
      serviceToken,
      folderId,
      driveFileName,
      file.type || "application/octet-stream",
      fileBytes,
    );

    await setPublicPermission(serviceToken, driveFileId);

    await firestorePatchDoc(serviceToken, projectId, `training_materials/${materialId}`, {
      file_path: driveFileId,
      file_bucket: "google-drive",
      updated_by: uid,
      updated_at: new Date().toISOString(),
    });

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
