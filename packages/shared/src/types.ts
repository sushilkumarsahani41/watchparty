/** Value Firebase stores for ServerValue.TIMESTAMP once resolved (ms since epoch). */
export type ServerTimestamp = number;

export interface UserProfile {
  email: string;
  displayName: string;
  createdAt: ServerTimestamp;
}

/** rooms/{roomId}/meta */
export interface RoomMeta {
  title: string;
  hostUid: string;
  createdAt: ServerTimestamp;
  /** Where the video comes from. Missing = "hls" (rooms created before YouTube support). */
  source?: VideoSource;
  /** HLS rooms: UUID, also the R2 folder name. YouTube rooms: "". */
  videoId: string;
  /** HLS rooms: https://media.<domain>/videos/{videoId}/master.m3u8. YouTube rooms: "". */
  hlsUrl: string;
  /** YouTube rooms: the 11-character video id. */
  youtubeId?: string;
  /** 0 when unknown (YouTube rooms: the player reports it). */
  durationSec: number;
}

export type VideoSource = "hls" | "youtube";

/** rooms/{roomId}/state: shared playback state, any member may write. */
export interface PlaybackState {
  playing: boolean;
  /** Video time in seconds at `updatedAt`. */
  position: number;
  updatedAt: ServerTimestamp;
  rate: number;
  /** Incremented on every write. */
  rev: number;
  /** uid of the last writer. */
  by: string;
}

/** rooms/{roomId}/presence/{uid} */
export interface Presence {
  online: boolean;
  buffering: boolean;
  name: string;
  lastSeen: ServerTimestamp;
}

export type PresenceMap = Record<string, Presence>;

/** chats/{roomId}/{pushId} */
export interface ChatMessage {
  uid: string;
  name: string;
  text: string;
  ts: ServerTimestamp;
}

export const CHAT_MAX_LENGTH = 1000;
