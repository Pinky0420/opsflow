"use client";

import * as tus from "tus-js-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

export type UploadTarget = {
  bucket: string;
  objectPath: string;
  signedUrl: string;
};

function getStorageResumableEndpoint(projectUrl?: string) {
  if (!projectUrl) throw new Error("missing_supabase_url");
  const url = new URL(projectUrl);
  url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  url.pathname = "/storage/v1/upload/resumable";
  url.search = "";
  return url.toString();
}

async function putFileWithProgress(params: {
  url: string;
  file: File;
  contentType: string;
  anonKey?: string;
  onProgress: (percent: number) => void;
}) {
  const { url, file, contentType, anonKey, onProgress } = params;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("content-type", contentType);
    if (anonKey) {
      xhr.setRequestHeader("apikey", anonKey);
      xhr.setRequestHeader("Authorization", `Bearer ${anonKey}`);
    }
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const percent = Math.round((evt.loaded / evt.total) * 100);
      onProgress(Math.max(0, Math.min(100, percent)));
    };

    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.onabort = () => reject(new Error("upload_failed"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let detail = (xhr.responseText || "").trim();
        try {
          const parsed = JSON.parse(detail) as { error?: string; message?: string; statusCode?: number };
          detail = [parsed.error, parsed.message].filter(Boolean).join(" ") || detail;
        } catch {
        }
        detail = detail.slice(0, 200);
        reject(new Error(detail ? `upload_failed_${xhr.status}:${detail}` : `upload_failed_${xhr.status}`));
      }
    };

    xhr.send(file);
  });
}

async function uploadFileResumable(params: {
  file: File;
  bucketName: string;
  objectName: string;
  contentType: string;
  onProgress: (percent: number) => void;
}) {
  const { file, bucketName, objectName, contentType, onProgress } = params;
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("unauthorized");
  }

  const endpoint = getStorageResumableEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL);

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName,
        objectName,
        contentType,
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError(error) {
        reject(new Error(error.message || "upload_failed"));
      },
      onProgress(bytesUploaded, bytesTotal) {
        const percent = Math.round((bytesUploaded / bytesTotal) * 100);
        onProgress(Math.max(0, Math.min(100, percent)));
      },
      onSuccess() {
        resolve();
      },
    });

    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    }).catch((error) => {
      reject(new Error(error instanceof Error ? error.message : "upload_failed"));
    });
  });
}

export function shouldUseResumableUpload(contentType: string, fileSize: number) {
  return contentType === "video" || fileSize > RESUMABLE_THRESHOLD_BYTES;
}

export async function uploadTrainingFile(params: {
  file: File;
  uploadContentType: string;
  uploadTarget: UploadTarget;
  onProgress: (percent: number) => void;
}) {
  const { file, uploadContentType, uploadTarget, onProgress } = params;
  const contentTypeForUpload = file.type || "application/octet-stream";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (shouldUseResumableUpload(uploadContentType, file.size)) {
    await uploadFileResumable({
      file,
      bucketName: uploadTarget.bucket,
      objectName: uploadTarget.objectPath,
      contentType: contentTypeForUpload,
      onProgress,
    });
  } else {
    await putFileWithProgress({
      url: uploadTarget.signedUrl,
      file,
      contentType: contentTypeForUpload,
      anonKey,
      onProgress,
    });
  }

  return {
    filePath: uploadTarget.objectPath,
    mimeType: contentTypeForUpload,
  };
}
