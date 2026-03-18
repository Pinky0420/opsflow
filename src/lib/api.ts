import { firebaseAuth } from "@/lib/firebase/client";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/$/, "");

async function getBearerToken(): Promise<string | null> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

type ApiFetchOptions = RequestInit & { auth?: boolean };

export async function apiFetch(
  localPath: string,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const { auth = false, ...fetchOptions } = options;

  if (!API_BASE) {
    return fetch(localPath, fetchOptions);
  }

  const functionName = localPath
    .replace(/^\/api\//, "")
    .replace(/^auth\//, "auth-")
    .replace(/^admin\/access\/([^/]+)\/set-password$/, "admin-set-password?id=$1")
    .replace(/^admin\/access\/([^/]+)$/, "admin-access-item?id=$1")
    .replace(/^admin\/access$/, "admin-access")
    .replace(/^admin\/bootstrap$/, "admin-bootstrap")
    .replace(/^training\/([^/]+)\/download-url$/, "training-download-url?id=$1")
    .replace(/^training\/([^/]+)\/upload-url$/, "training-upload-url?id=$1")
    .replace(/\//g, "-");

  const url = `${API_BASE}/${functionName}`;

  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string> ?? {}),
  };

  if (auth) {
    const token = await getBearerToken();
    if (!token) {
      throw new Error("missing_session_access_token");
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(url, { ...fetchOptions, headers });
}
