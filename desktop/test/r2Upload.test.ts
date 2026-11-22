import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mockClient } from "aws-sdk-client-mock";
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { deleteVideo, listVideos, planUpload, uploadAll } from "../src/main/r2Upload";

const s3 = mockClient(S3Client);
const notFound = Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });

async function fakeHls() {
  const dir = await mkdtemp(path.join(tmpdir(), "wp-up-"));
  for (const v of ["480p", "720p"]) {
    await mkdir(path.join(dir, v));
    await writeFile(path.join(dir, v, "index.m3u8"), "#EXTM3U\n");
    for (let i = 0; i < 3; i++) await writeFile(path.join(dir, v, `seg_0000${i}.ts`), Buffer.alloc(1000 + i));
  }
  await writeFile(path.join(dir, "master.m3u8"), "#EXTM3U\n");
  await writeFile(path.join(dir, ".DS_Store"), "junk");
  return dir;
}

describe("r2 upload", () => {
  beforeEach(() => s3.reset());

  it("plans keys, content types and cache headers; ignores junk files", async () => {
    const dir = await fakeHls();
    try {
      const items = await planUpload(dir, "vid1");
      expect(items).toHaveLength(9);
      expect(items.map((i) => i.kind)).toEqual([...Array(6).fill("segment"), "variant", "variant", "master"]);
      expect(items.at(-1)).toMatchObject({ key: "videos/vid1/master.m3u8", contentType: "application/vnd.apple.mpegurl", cacheControl: "public, max-age=60" });
      expect(items[0]).toMatchObject({ key: "videos/vid1/480p/seg_00000.ts", contentType: "video/mp2t", cacheControl: "public, max-age=31536000, immutable" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uploads segments, then variant playlists, then master; reports progress", async () => {
    const dir = await fakeHls();
    try {
      s3.on(HeadObjectCommand).rejects(notFound);
      s3.on(PutObjectCommand).resolves({});
      const items = await planUpload(dir, "vid1");
      const progress: number[] = [];
      await uploadAll(new S3Client({}), "bucket", items, { concurrency: 3, onProgress: (d, t) => progress.push(d / t) });
      const keys = s3.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key!);
      expect(keys).toHaveLength(9);
      expect(keys.at(-1)).toBe("videos/vid1/master.m3u8");
      expect(keys.slice(6, 8).every((k) => k.endsWith("index.m3u8"))).toBe(true);
      expect(keys.slice(0, 6).every((k) => k.endsWith(".ts"))).toBe(true);
      expect(progress.at(-1)).toBe(1);
      const put = s3.commandCalls(PutObjectCommand)[0]!.args[0].input;
      expect(put).toMatchObject({ Bucket: "bucket", ContentType: "video/mp2t" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resumes: skips keys already present with the same size", async () => {
    const dir = await fakeHls();
    try {
      const items = await planUpload(dir, "vid1");
      const existing = items.find((i) => i.kind === "segment")!;
      s3.on(HeadObjectCommand).rejects(notFound);
      s3.on(HeadObjectCommand, { Key: existing.key }).resolves({ ContentLength: existing.size });
      s3.on(PutObjectCommand).resolves({});
      await uploadAll(new S3Client({}), "bucket", items);
      const keys = s3.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key);
      expect(keys).toHaveLength(8);
      expect(keys).not.toContain(existing.key);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("retries transient failures with backoff, and gives up after max attempts", async () => {
    const dir = await fakeHls();
    try {
      const items = (await planUpload(dir, "vid1")).slice(0, 1);
      s3.on(HeadObjectCommand).rejects(notFound);
      s3.on(PutObjectCommand).rejectsOnce(new Error("socket hang up")).rejectsOnce(new Error("503")).resolves({});
      await uploadAll(new S3Client({}), "bucket", items, { backoffMs: 1 });
      expect(s3.commandCalls(PutObjectCommand)).toHaveLength(3);

      s3.reset();
      s3.on(HeadObjectCommand).rejects(notFound);
      s3.on(PutObjectCommand).rejects(new Error("always down"));
      await expect(uploadAll(new S3Client({}), "bucket", items, { backoffMs: 1, maxAttempts: 5 })).rejects.toThrow("always down");
      expect(s3.commandCalls(PutObjectCommand)).toHaveLength(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("r2 library", () => {
  beforeEach(() => s3.reset());
  const client = () => new S3Client({ region: "auto", credentials: { accessKeyId: "a", secretAccessKey: "b" } });

  it("groups files into videos across pages", async () => {
    s3.on(ListObjectsV2Command, { ContinuationToken: undefined }).resolves({
      Contents: [
        { Key: "videos/a/master.m3u8", Size: 10, LastModified: new Date(1000) },
        { Key: "videos/a/720p/seg_00000.ts", Size: 100, LastModified: new Date(3000) },
      ],
      IsTruncated: true,
      NextContinuationToken: "p2",
    });
    s3.on(ListObjectsV2Command, { ContinuationToken: "p2" }).resolves({
      Contents: [{ Key: "videos/b/master.m3u8", Size: 5, LastModified: new Date(2000) }],
      IsTruncated: false,
    });
    const v = (await listVideos(client(), "bkt")).sort((x, y) => x.videoId.localeCompare(y.videoId));
    expect(v).toEqual([
      { videoId: "a", bytes: 110, files: 2, modifiedMs: 3000 },
      { videoId: "b", bytes: 5, files: 1, modifiedMs: 2000 },
    ]);
  });

  it("deletes every file of a video in batches of 1000", async () => {
    const keys = Array.from({ length: 1500 }, (_, i) => ({ Key: `videos/a/seg_${i}.ts`, Size: 1 }));
    s3.on(ListObjectsV2Command).resolves({ Contents: keys, IsTruncated: false });
    s3.on(DeleteObjectsCommand).resolves({});
    expect(await deleteVideo(client(), "bkt", "a")).toBe(1500);
    const calls = s3.commandCalls(DeleteObjectsCommand);
    expect(calls.map((c) => c.args[0].input.Delete?.Objects?.length)).toEqual([1000, 500]);
    expect(s3.commandCalls(ListObjectsV2Command)[0]!.args[0].input.Prefix).toBe("videos/a/");
  });

  it("refuses ids that could escape the video folder", async () => {
    await expect(deleteVideo(client(), "bkt", "../x")).rejects.toThrow(/Invalid video id/);
    await expect(deleteVideo(client(), "bkt", "")).rejects.toThrow(/Invalid video id/);
  });

  it("reports per-file delete errors", async () => {
    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: "videos/a/x.ts", Size: 1 }] });
    s3.on(DeleteObjectsCommand).resolves({ Errors: [{ Key: "videos/a/x.ts", Message: "AccessDenied" }] });
    await expect(deleteVideo(client(), "bkt", "a")).rejects.toThrow(/AccessDenied/);
  });
});
