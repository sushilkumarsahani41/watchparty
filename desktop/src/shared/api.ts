/** Types shared by main, preload and renderer (the IPC contract). */
import type { Settings } from "../main/settings";
import type { Encoder, ProbeResult } from "../main/ffmpeg";

export type { Settings, Encoder, ProbeResult };

export interface PickedFile {
  path: string;
  name: string;
  sizeBytes: number;
  probe: ProbeResult;
  encoders: Encoder[];
}

export interface JobInput {
  file: string;
  title: string;
  /** e.g. ["360p", "720p"] */
  renditions: string[];
  encoder: Encoder;
}

export type JobPhase = "transcode" | "upload" | "room" | "done" | "error" | "cancelled";

export interface JobEvent {
  phase: JobPhase;
  /** 0..1 within the phase */
  progress: number;
  message?: string;
  /** Set when phase === "done" */
  result?: { roomId: string; inviteLink: string; hlsUrl: string };
  /** Upload failed but transcoded files are kept: the job can be retried without re-encoding. */
  canRetry?: boolean;
}

export interface Account {
  email: string;
  displayName: string;
}

export interface WatchPartyApi {
  settings: {
    get(): Promise<{ settings: Settings; missing: Array<keyof Settings> }>;
    save(s: Settings): Promise<void>;
  };
  auth: {
    signIn(email: string, password: string): Promise<{ ok: true; account: Account } | { ok: false; error: string }>;
    signOut(): Promise<void>;
  };
  pickFile(): Promise<PickedFile | null | { error: string }>;
  job: {
    start(input: JobInput): Promise<void>;
    retry(): Promise<void>;
    cancel(): Promise<void>;
    onEvent(cb: (e: JobEvent) => void): () => void;
  };
  copy(text: string): Promise<void>;
  open(url: string): Promise<void>;
}
