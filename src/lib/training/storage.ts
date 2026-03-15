import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type TrainingUploadRequest = {
  materialId: string;
  fileName: string;
};

export type TrainingUploadTarget = {
  bucket: string;
  objectPath: string;
  signedUrl: string;
  token: string;
};

const TRAINING_BUCKET = "training-files";

function buildSafeObjectPath(id: string, fileName: string) {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf(".");
  const rawBase = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const rawExt = dot > 0 ? trimmed.slice(dot).toLowerCase() : "";

  const safeBase = rawBase
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  const finalBase = safeBase || "file";
  return `${id}/${finalBase}${rawExt}`;
}

export async function createTrainingUploadTarget(input: TrainingUploadRequest): Promise<TrainingUploadTarget> {
  const admin = createSupabaseAdminClient();
  const objectPath = buildSafeObjectPath(input.materialId, input.fileName);
  const { data, error } = await admin.storage.from(TRAINING_BUCKET).createSignedUploadUrl(objectPath);

  if (error || !data) {
    throw new Error("signed_upload_failed");
  }

  return {
    bucket: TRAINING_BUCKET,
    objectPath,
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

export async function createTrainingDownloadUrl(input: { bucket: string; objectPath: string; expiresIn?: number }) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(input.bucket)
    .createSignedUrl(input.objectPath, input.expiresIn ?? 60);

  if (error || !data) {
    throw new Error(error?.message || "signed_download_failed");
  }

  return data.signedUrl;
}

export function getTrainingBucketName() {
  return TRAINING_BUCKET;
}
