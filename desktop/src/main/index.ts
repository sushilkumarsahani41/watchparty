import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { hlsUrlFor, inviteLinkFor } from "@watchparty/shared";
import type { JobEvent, JobInput, PickedFile } from "../shared/api";
import { CancelledError, detectEncoders, pickRenditions, probe, transcode, type Encoder } from "./ffmpeg";
import { authErrorMessage, createRoom, currentUid, signIn, signOut } from "./firebase";
import { planUpload, r2Client, uploadAll } from "./r2Upload";
import { loadSettings, missingSettings, saveSettings, type Settings } from "./settings";

/** ffmpeg-static lives inside app.asar in packaged builds; binaries must run from the unpacked copy. */
const ffmpegPath = String(ffmpegStatic).replace("app.asar", "app.asar.unpacked");

let win: BrowserWindow | null = null;
let encoders: Encoder[] | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 520,
    minHeight: 560,
    backgroundColor: "#17151f",
    title: "WatchParty Uploader",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Open external links in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

// ---------------- Job orchestration ----------------

interface ActiveJob {
  input: JobInput;
  videoId: string;
  outDir: string;
  durationSec: number;
  controller: AbortController;
  transcoded: boolean;
  /** True while runJob is executing (false when failed and waiting for retry). */
  running: boolean;
}

let job: ActiveJob | null = null;

const emit = (e: JobEvent) => win?.webContents.send("job:event", e);

async function cleanup(j: ActiveJob) {
  await rm(j.outDir, { recursive: true, force: true }).catch(() => {});
}

async function runJob(j: ActiveJob) {
  const s = await loadSettings();
  const missing = missingSettings(s);
  if (missing.length) throw new Error(`Finish setup first (missing: ${missing.join(", ")}).`);

  if (!j.transcoded) {
    const info = await probe(ffmpegPath, j.input.file);
    j.durationSec = info.durationSec;
    const renditions = pickRenditions(j.input.renditions, info.height);
    emit({ phase: "transcode", progress: 0, message: `Encoding ${renditions.map((r) => r.name).join(", ")}…` });
    await transcode(
      ffmpegPath,
      { input: j.input.file, outDir: j.outDir, renditions, encoder: j.input.encoder, hasAudio: info.hasAudio, durationSec: info.durationSec },
      (f) => emit({ phase: "transcode", progress: f }),
      j.controller.signal,
    );
    j.transcoded = true;
  }

  const items = await planUpload(j.outDir, j.videoId);
  emit({ phase: "upload", progress: 0, message: `Uploading ${items.length} files…` });
  await uploadAll(
    r2Client({ accountId: s.r2AccountId, accessKeyId: s.r2AccessKeyId, secretAccessKey: s.r2SecretAccessKey, bucket: s.r2Bucket }),
    s.r2Bucket,
    items,
    {
      concurrency: 6,
      signal: j.controller.signal,
      onProgress: (done, total) =>
        emit({ phase: "upload", progress: total ? done / total : 1, message: `${(done / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB` }),
    },
  );

  emit({ phase: "room", progress: 0, message: "Creating room…" });
  const hlsUrl = hlsUrlFor(s.mediaBaseUrl, j.videoId);
  const roomId = await createRoom(s, {
    title: j.input.title.trim() || path.parse(j.input.file).name,
    videoId: j.videoId,
    hlsUrl,
    durationSec: Math.round(j.durationSec * 1000) / 1000,
  });
  await cleanup(j);
  emit({ phase: "done", progress: 1, result: { roomId, inviteLink: inviteLinkFor(s.webBaseUrl, roomId), hlsUrl } });
  job = null;
}

async function startJob(j: ActiveJob) {
  j.running = true;
  try {
    await runJob(j);
  } catch (e) {
    if (e instanceof CancelledError || j.controller.signal.aborted) {
      await cleanup(j);
      job = null;
      emit({ phase: "cancelled", progress: 0, message: "Cancelled." });
      return;
    }
    // Keep encoded files if transcoding finished, so the upload can be retried (and resumed).
    if (!j.transcoded) {
      await cleanup(j);
      job = null;
    }
    emit({ phase: "error", progress: 0, message: e instanceof Error ? e.message : String(e), canRetry: j.transcoded });
  } finally {
    j.running = false;
  }
}

// ---------------- IPC ----------------

function registerIpc() {
  ipcMain.handle("settings:get", async () => {
    const settings = await loadSettings();
    return { settings, missing: missingSettings(settings) };
  });
  ipcMain.handle("settings:save", async (_e, s: Settings) => saveSettings(s));

  ipcMain.handle("auth:signIn", async (_e, email: string, password: string) => {
    try {
      const u = await signIn(await loadSettings(), email, password);
      return { ok: true, account: { email: u.email, displayName: u.displayName } };
    } catch (e) {
      return { ok: false, error: authErrorMessage(e) };
    }
  });
  ipcMain.handle("auth:signOut", () => signOut());

  ipcMain.handle("file:pick", async (): Promise<PickedFile | null | { error: string }> => {
    // Dev/testing only: preselect a file (native dialogs can't be automated).
    const testFile = !app.isPackaged ? process.env.WATCHPARTY_PICK_FILE : undefined;
    const r = testFile
      ? { canceled: false, filePaths: [testFile] }
      : await dialog.showOpenDialog(win!, {
      title: "Choose a video",
      properties: ["openFile"],
      filters: [{ name: "Video", extensions: ["mp4", "mkv", "mov", "avi", "webm", "m4v", "ts", "wmv", "flv"] }],
    });
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    try {
      encoders ??= await detectEncoders(ffmpegPath);
      return {
        path: file,
        name: path.basename(file),
        sizeBytes: (await stat(file)).size,
        probe: await probe(ffmpegPath, file),
        encoders,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("job:start", async (_e, input: JobInput) => {
    if (job) throw new Error("A job is already running.");
    if (!currentUid()) throw new Error("Sign in first.");
    const videoId = randomUUID();
    job = {
      input,
      videoId,
      outDir: path.join(tmpdir(), "watchparty", videoId),
      durationSec: 0,
      controller: new AbortController(),
      transcoded: false,
      running: false,
    };
    void startJob(job);
  });

  ipcMain.handle("job:retry", async () => {
    if (!job || job.running) throw new Error("Nothing to retry.");
    job.controller = new AbortController();
    void startJob(job);
  });

  ipcMain.handle("job:cancel", async () => {
    if (!job) return;
    if (job.running) {
      job.controller.abort(); // startJob cleans up and reports "cancelled"
      return;
    }
    // A failed job waiting for retry has nothing running: discard its files directly.
    const j = job;
    job = null;
    await cleanup(j);
    emit({ phase: "cancelled", progress: 0, message: "Cancelled." });
  });

  ipcMain.handle("clipboard:write", (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle("shell:open", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  job?.controller.abort();
  if (process.platform !== "darwin") app.quit();
});
