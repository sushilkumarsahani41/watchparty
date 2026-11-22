import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface Rendition {
  name: string;
  height: number;
  /** kbit/s */
  bitrate: number;
  maxrate: number;
  bufsize: number;
}

/** Spec tiers (+ a 360p tier for slow connections). */
export const RENDITIONS: readonly Rendition[] = [
  { name: "360p", height: 360, bitrate: 600, maxrate: 660, bufsize: 1200 },
  { name: "480p", height: 480, bitrate: 1000, maxrate: 1100, bufsize: 2000 },
  { name: "720p", height: 720, bitrate: 2500, maxrate: 2750, bufsize: 5000 },
  { name: "1080p", height: 1080, bitrate: 5000, maxrate: 5500, bufsize: 10000 },
];

export type Encoder = "libx264" | "h264_videotoolbox" | "h264_nvenc";

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export const SEGMENT_SEC = 6;
/** Keyframe every 2s: segments cut cleanly at 6s, and seeks land close to the target. */
const KEYFRAME_SEC = 2;

function run(ffmpeg: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Parse `ffmpeg -i` stderr (no ffprobe in ffmpeg-static). Exported for tests. */
export function parseProbe(stderr: string): ProbeResult {
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = stderr.match(/Stream #\S+.*?Video:.*?(\d{2,5})x(\d{2,5})[^\n]*/);
  if (!dur || !video) throw new Error("Couldn't read this file. Is it a video?");
  const fps = video[0].match(/(\d+(?:\.\d+)?)\s*fps/) ?? video[0].match(/(\d+(?:\.\d+)?)\s*tbr/);
  return {
    durationSec: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    width: Number(video[1]),
    height: Number(video[2]),
    fps: fps ? Number(fps[1]) : 30,
    hasAudio: /Stream #\S+.*?Audio:/.test(stderr),
  };
}

export async function probe(ffmpeg: string, input: string): Promise<ProbeResult> {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-i", input]);
  return parseProbe(stderr);
}

/** Hardware encoders that are both compiled in and actually usable on this machine. */
export async function detectEncoders(ffmpeg: string): Promise<Encoder[]> {
  const { stdout } = await run(ffmpeg, ["-hide_banner", "-encoders"]);
  const found: Encoder[] = ["libx264"];
  for (const enc of ["h264_videotoolbox", "h264_nvenc"] as const) {
    if (!stdout.includes(enc)) continue;
    // Compiled in isn't enough (e.g. nvenc without an NVIDIA GPU): try a 1-frame encode.
    const test = await run(ffmpeg, [
      "-hide_banner", "-f", "lavfi", "-i", "color=c=black:s=256x144:d=0.1", "-frames:v", "1", "-c:v", enc, "-f", "null", "-",
    ]);
    if (test.code === 0) found.push(enc);
  }
  return found;
}

/** Renditions to produce: chosen tiers not taller than the source (at least one). */
export function pickRenditions(chosen: string[], sourceHeight: number): Rendition[] {
  const picked = RENDITIONS.filter((r) => chosen.includes(r.name) && r.height <= sourceHeight);
  if (picked.length) return picked;
  // Source smaller than every chosen tier: one rendition at the source height (even, for H.264).
  const base = RENDITIONS.find((r) => chosen.includes(r.name)) ?? RENDITIONS[0]!;
  const h = Math.max(2, sourceHeight - (sourceHeight % 2));
  return [{ ...base, name: `${h}p`, height: h }];
}

export interface TranscodeOptions {
  input: string;
  outDir: string;
  renditions: Rendition[];
  encoder: Encoder;
  hasAudio: boolean;
  /** libx264 preset */
  preset?: string;
}

/** Multi-rendition HLS (H.264 + AAC, 6s segments, master playlist). Exported for tests. */
export function buildArgs(o: TranscodeOptions): string[] {
  const n = o.renditions.length;
  const split = n > 1 ? `[0:v]split=${n}${o.renditions.map((_, i) => `[v${i}]`).join("")};` : "[0:v]null[v0];";
  const scales = o.renditions.map((r, i) => `[v${i}]scale=-2:${r.height}[v${i}o]`).join(";");

  const args = ["-hide_banner", "-y", "-i", o.input, "-filter_complex", split + scales];

  o.renditions.forEach((r, i) => {
    args.push(
      "-map", `[v${i}o]`,
      `-c:v:${i}`, o.encoder,
      `-b:v:${i}`, `${r.bitrate}k`,
      `-maxrate:v:${i}`, `${r.maxrate}k`,
      `-bufsize:v:${i}`, `${r.bufsize}k`,
    );
  });
  if (o.encoder === "libx264") args.push("-preset", o.preset ?? "veryfast", "-sc_threshold", "0");
  if (o.encoder === "h264_nvenc") args.push("-preset", "p4");
  args.push("-pix_fmt", "yuv420p", "-force_key_frames", `expr:gte(t,n_forced*${KEYFRAME_SEC})`);

  if (o.hasAudio) {
    for (let i = 0; i < n; i++) args.push("-map", "a:0");
    args.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
  }

  const streamMap = o.renditions
    .map((r, i) => (o.hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`))
    .join(" ");

  args.push(
    "-f", "hls",
    "-hls_time", String(SEGMENT_SEC),
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",
    "-hls_segment_filename", path.join(o.outDir, "%v", "seg_%05d.ts"),
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", streamMap,
    "-progress", "pipe:1",
    "-nostats",
    path.join(o.outDir, "%v", "index.m3u8"),
  );
  return args;
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

/** Run the transcode; reports 0..1 progress; rejects with CancelledError on abort. */
export async function transcode(
  ffmpeg: string,
  o: TranscodeOptions & { durationSec: number },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new CancelledError();
  await mkdir(o.outDir, { recursive: true });
  // ffmpeg doesn't create the %v directories itself.
  await Promise.all(o.renditions.map((r) => mkdir(path.join(o.outDir, r.name), { recursive: true })));

  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpeg, buildArgs(o), { windowsHide: true });
    let stderrTail = "";
    let buf = "";
    const onAbort = () => p.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });

    p.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m && o.durationSec > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / o.durationSec));
      }
    });
    p.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(new CancelledError());
      if (code === 0) {
        onProgress(1);
        return resolve();
      }
      const lastLines = stderrTail.trim().split("\n").slice(-3).join("\n");
      reject(new Error(`ffmpeg failed (exit ${code}):\n${lastLines}`));
    });
  });
}
