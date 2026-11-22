import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CancelledError } from "./ffmpeg";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function r2Client(c: R2Config): S3Client {
  // R2_ENDPOINT is a dev/testing override (e.g. a local S3-compatible server).
  const override = process.env.R2_ENDPOINT;
  return new S3Client({
    region: "auto",
    endpoint: override || `https://${c.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(override),
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
}

export type FileKind = "segment" | "variant" | "master";

export interface UploadItem {
  key: string;
  file: string;
  size: number;
  kind: FileKind;
  contentType: string;
  cacheControl: string;
}

const SEGMENT_CACHE = "public, max-age=31536000, immutable";
const PLAYLIST_CACHE = "public, max-age=60";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)]))),
  );
  return nested.flat();
}

/** Every file under the HLS output dir, keyed `videos/<id>/<relative path>`, segments first. */
export async function planUpload(outDir: string, videoId: string): Promise<UploadItem[]> {
  const files = await walk(outDir);
  const items: UploadItem[] = [];
  for (const file of files) {
    const rel = path.relative(outDir, file).split(path.sep).join("/");
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".ts" && ext !== ".m3u8") continue;
    const kind: FileKind = ext === ".ts" ? "segment" : rel === "master.m3u8" ? "master" : "variant";
    items.push({
      key: `videos/${videoId}/${rel}`,
      file,
      size: (await stat(file)).size,
      kind,
      contentType: ext === ".ts" ? "video/mp2t" : "application/vnd.apple.mpegurl",
      cacheControl: ext === ".ts" ? SEGMENT_CACHE : PLAYLIST_CACHE,
    });
  }
  const order: Record<FileKind, number> = { segment: 0, variant: 1, master: 2 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
}

export interface UploadOptions {
  concurrency?: number;
  maxAttempts?: number;
  /** Base backoff in ms (doubles per attempt, plus jitter). */
  backoffMs?: number;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new CancelledError());
    }, { once: true });
  });

async function withRetry<T>(fn: () => Promise<T>, attempts: number, backoffMs: number, signal?: AbortSignal): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new CancelledError();
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw new CancelledError();
      if (i < attempts - 1) await sleep(backoffMs * 2 ** i + Math.random() * backoffMs, signal);
    }
  }
  throw lastErr;
}

/** True if the key already exists with the same size (resume after a failed/cancelled upload). */
async function alreadyUploaded(client: S3Client, bucket: string, item: UploadItem): Promise<boolean> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key }));
    return head.ContentLength === item.size;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as { name?: string }).name === "NotFound") return false;
    throw e;
  }
}

/**
 * Upload in three phases so a player never sees a playlist pointing at missing segments:
 * segments (parallel), then variant playlists, then master.m3u8.
 */
export async function uploadAll(client: S3Client, bucket: string, items: UploadItem[], o: UploadOptions = {}) {
  const concurrency = o.concurrency ?? 6;
  const attempts = o.maxAttempts ?? 5;
  const backoff = o.backoffMs ?? 500;
  const total = items.reduce((n, i) => n + i.size, 0);
  let done = 0;
  o.onProgress?.(0, total);

  const uploadOne = async (item: UploadItem) => {
    await withRetry(async () => {
      if (await alreadyUploaded(client, bucket, item)) return;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: item.key,
          Body: await readFile(item.file),
          ContentLength: item.size,
          ContentType: item.contentType,
          CacheControl: item.cacheControl,
        }),
        { abortSignal: o.signal },
      );
    }, attempts, backoff, o.signal);
    done += item.size;
    o.onProgress?.(done, total);
  };

  const runPool = async (batch: UploadItem[]) => {
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        if (o.signal?.aborted) throw new CancelledError();
        await uploadOne(batch[next++]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
  };

  await runPool(items.filter((i) => i.kind === "segment"));
  await runPool(items.filter((i) => i.kind === "variant"));
  await runPool(items.filter((i) => i.kind === "master"));
}

/** Every key under a prefix (handles pagination). */
async function listKeys(client: S3Client, bucket: string, prefix: string): Promise<Array<{ key: string; size: number; modified?: Date }>> {
  const out: Array<{ key: string; size: number; modified?: Date }> = [];
  let token: string | undefined;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export interface StoredVideo {
  videoId: string;
  bytes: number;
  files: number;
  /** Newest file time (ms). */
  modifiedMs: number;
}

/** Uploaded videos in the bucket (one per videos/<id>/ folder). */
export async function listVideos(client: S3Client, bucket: string): Promise<StoredVideo[]> {
  const byId = new Map<string, StoredVideo>();
  for (const o of await listKeys(client, bucket, "videos/")) {
    const videoId = o.key.split("/")[1];
    if (!videoId) continue;
    const v = byId.get(videoId) ?? { videoId, bytes: 0, files: 0, modifiedMs: 0 };
    v.bytes += o.size;
    v.files += 1;
    v.modifiedMs = Math.max(v.modifiedMs, o.modified?.getTime() ?? 0);
    byId.set(videoId, v);
  }
  return [...byId.values()];
}

/** Delete every file of one uploaded video. Returns the number of files deleted. */
export async function deleteVideo(client: S3Client, bucket: string, videoId: string): Promise<number> {
  if (!/^[\w-]+$/.test(videoId)) throw new Error(`Invalid video id: ${videoId}`);
  const keys = (await listKeys(client, bucket, `videos/${videoId}/`)).map((o) => o.key);
  // DeleteObjects takes at most 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const r = await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }),
    );
    if (r.Errors?.length) throw new Error(`Couldn't delete ${r.Errors.length} file(s): ${r.Errors[0]?.Message ?? "unknown error"}`);
  }
  return keys.length;
}
