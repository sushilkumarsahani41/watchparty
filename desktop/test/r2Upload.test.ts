import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mockClient } from "aws-sdk-client-mock";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { planUpload, uploadAll } from "../src/main/r2Upload";

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
