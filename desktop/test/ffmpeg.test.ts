import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { CancelledError, buildArgs, parseProbe, pickRenditions, probe, transcode, RENDITIONS } from "../src/main/ffmpeg";

const ffmpeg = ffmpegPath as unknown as string;

/** Make a small test clip with ffmpeg's built-in sources. */
function makeClip(file: string, opts: { seconds: number; height: number; audio: boolean }) {
  const w = Math.round((opts.height * 16) / 9 / 2) * 2;
  const args = ["-hide_banner", "-y", "-f", "lavfi", "-i", `testsrc2=s=${w}x${opts.height}:r=24:d=${opts.seconds}`];
  if (opts.audio) args.push("-f", "lavfi", "-i", `sine=f=440:d=${opts.seconds}`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (opts.audio) args.push("-c:a", "aac", "-shortest");
  args.push(file);
  const r = spawnSync(ffmpeg, args);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

describe("ffmpeg helpers", () => {
  it("parses probe output", () => {
    const p = parseProbe(`  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 4000 kb/s, 23.98 fps, 23.98 tbr
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s`);
    expect(p).toEqual({ durationSec: 62.5, width: 1920, height: 1080, fps: 23.98, hasAudio: true });
  });

  it("rejects non-video input", () => {
    expect(() => parseProbe("Invalid data found when processing input")).toThrow(/Is it a video/);
  });

  it("skips renditions taller than the source", () => {
    expect(pickRenditions(["360p", "480p", "720p", "1080p"], 720).map((r) => r.name)).toEqual(["360p", "480p", "720p"]);
  });

  it("falls back to the source height for tiny sources", () => {
    expect(pickRenditions(["480p", "720p"], 241).map((r) => [r.name, r.height])).toEqual([["240p", 240]]);
  });

  it("maps audio per rendition only when the source has audio", () => {
    const r = RENDITIONS.slice(1, 3);
    const withAudio = buildArgs({ input: "in.mp4", outDir: "/o", renditions: r, encoder: "libx264", hasAudio: true });
    const noAudio = buildArgs({ input: "in.mp4", outDir: "/o", renditions: r, encoder: "libx264", hasAudio: false });
    expect(withAudio.join(" ")).toContain("v:0,a:0,name:480p v:1,a:1,name:720p");
    expect(noAudio.join(" ")).toContain("v:0,name:480p v:1,name:720p");
    expect(noAudio).not.toContain("a:0");
  });
});

describe("transcode (real ffmpeg)", () => {
  for (const audio of [true, false]) {
    it(`produces a playable multi-rendition HLS set (${audio ? "with" : "no"} audio)`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "wp-ff-"));
      try {
        const clip = path.join(dir, "in.mp4");
        makeClip(clip, { seconds: 14, height: 720, audio });
        const info = await probe(ffmpeg, clip);
        expect(info).toMatchObject({ height: 720, hasAudio: audio });
        expect(info.durationSec).toBeCloseTo(14, 0);

        const renditions = pickRenditions(["360p", "480p", "720p", "1080p"], info.height);
        const progress: number[] = [];
        const out = path.join(dir, "hls");
        await transcode(ffmpeg, { input: clip, outDir: out, renditions, encoder: "libx264", hasAudio: audio, durationSec: info.durationSec }, (f) => progress.push(f));

        expect(progress.at(-1)).toBe(1);
        const master = await readFile(path.join(out, "master.m3u8"), "utf8");
        for (const r of ["360p", "480p", "720p"]) expect(master).toContain(`${r}/index.m3u8`);
        expect(master).not.toContain("1080p");
        expect(master).toMatch(/RESOLUTION=\d+x720/);
        if (audio) expect(master).toMatch(/CODECS="avc1\.[0-9a-f]+,mp4a/);
        const variant = await readFile(path.join(out, "720p", "index.m3u8"), "utf8");
        expect(variant).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
        expect(variant).toContain("#EXT-X-ENDLIST");
        const segs = (await readdir(path.join(out, "720p"))).filter((f) => f.endsWith(".ts"));
        expect(segs.length).toBe(3); // 14s / 6s
        const durations = [...variant.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
        expect(durations[0]).toBeCloseTo(6, 0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, 120_000);
  }

  it("cancels by killing ffmpeg", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wp-ff-"));
    try {
      const clip = path.join(dir, "in.mp4");
      makeClip(clip, { seconds: 60, height: 1080, audio: true });
      const ac = new AbortController();
      const started = Date.now();
      const p = transcode(ffmpeg, { input: clip, outDir: path.join(dir, "hls"), renditions: [...RENDITIONS], encoder: "libx264", hasAudio: true, durationSec: 60, preset: "medium" }, () => {}, ac.signal);
      setTimeout(() => ac.abort(), 500);
      await expect(p).rejects.toBeInstanceOf(CancelledError);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
