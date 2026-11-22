import { paths } from "./paths";
import type { VideoSource } from "./types";

export interface NewRoom {
  roomId: string;
  hostUid: string;
  title: string;
  source?: VideoSource;
  videoId: string;
  hlsUrl: string;
  youtubeId?: string;
  durationSec: number;
}

/**
 * The RTDB writes that create a room, split in the order they must be applied:
 * rules check membership against *existing* data, so `membership` must land before `content`.
 * `serverTs` is the SDK's ServerValue.TIMESTAMP sentinel (serverTimestamp() in the JS SDK).
 */
export function roomCreationWrites(room: NewRoom, serverTs: object) {
  return {
    membership: {
      [paths.roomMember(room.roomId, room.hostUid)]: true,
      [paths.userRoom(room.hostUid, room.roomId)]: true,
    },
    content: {
      [paths.roomMeta(room.roomId)]: {
        title: room.title,
        hostUid: room.hostUid,
        createdAt: serverTs,
        source: room.source ?? "hls",
        videoId: room.videoId,
        hlsUrl: room.hlsUrl,
        ...(room.youtubeId ? { youtubeId: room.youtubeId } : {}),
        durationSec: room.durationSec,
      },
      [paths.roomState(room.roomId)]: {
        playing: false,
        position: 0,
        updatedAt: serverTs,
        rate: 1,
        rev: 0,
        by: room.hostUid,
      },
    },
  };
}

/** Public HLS URL for an uploaded video: <mediaBase>/videos/<videoId>/master.m3u8 */
export function hlsUrlFor(mediaBaseUrl: string, videoId: string): string {
  return `${mediaBaseUrl.replace(/\/+$/, "")}/videos/${videoId}/master.m3u8`;
}

/**
 * Room codes: 8 characters from a 32-letter alphabet without look-alikes (no 0/O, 1/I).
 * 32^8 ≈ 1.1 trillion codes. The code is the room id, so it is also what invite links carry.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 8;

/** A new random room code. `randomBytes` defaults to the Web Crypto API (browsers, Node 19+). */
/** Web Crypto exists in every runtime we target; declared here because this package doesn't include DOM types. */
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

export function generateRoomCode(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  // 256 is a multiple of 32, so `byte % 32` is unbiased.
  return Array.from(randomBytes(ROOM_CODE_LENGTH), (b) => ROOM_CODE_ALPHABET[b % 32]).join("");
}

/** "ABCD2345" -> "ABCD-2345" for display. Other ids are returned unchanged. */
export function formatRoomCode(roomId: string): string {
  return /^[A-Z0-9]{8}$/.test(roomId) ? `${roomId.slice(0, 4)}-${roomId.slice(4)}` : roomId;
}

/** Rooms created before codes existed use RTDB push ids: 20 chars of [-_0-9A-Za-z]. */
const LEGACY_ROOM_ID_RE = /^[-_0-9A-Za-z]{16,40}$/;

/**
 * Room id from what a user typed or pasted: an invite link (https://…/room/<id>, watchparty://room/<id>),
 * a room code in any case with optional spaces/dashes ("abcd-2345"), or a legacy push id.
 * Returns null if it isn't one. Test cases: rooms.vectors.json (shared with Android).
 */
export function parseRoomInput(input: string): string | null {
  const trimmed = input.trim();
  const id = trimmed.match(/\/room\/([^/?#\s]+)/)?.[1] ?? trimmed;
  const code = id.replace(/[\s-]/g, "").toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(code)) return code;
  if (LEGACY_ROOM_ID_RE.test(id)) return id;
  return null;
}

/**
 * Multi-path update that deletes a room (host only; see database.rules.json): its state, meta, presence,
 * members and chat, plus the host's own "my rooms" entry. Other members' "my rooms" entries can't be
 * removed by the host; the apps skip rooms they can no longer read.
 */
export function roomDeletionWrites(roomId: string, hostUid: string): Record<string, null> {
  return {
    [paths.room(roomId)]: null,
    [paths.roomMembers(roomId)]: null,
    [paths.chat(roomId)]: null,
    [paths.userRoom(hostUid, roomId)]: null,
  };
}

/** Web invite link: <webBase>/room/<roomId> */
export function inviteLinkFor(webBaseUrl: string, roomId: string): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/room/${roomId}`;
}

/**
 * YouTube video id from a link or a bare id: youtube.com/watch?v=…, youtu.be/…, /shorts/…, /embed/…,
 * /live/…, m./music. subdomains. Returns null otherwise. Test cases: rooms.vectors.json (shared with Android).
 */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m =
    s.match(/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/)([\w-]{11})(?![\w-])/i) ??
    s.match(/^(?:https?:\/\/)?youtu\.be\/([\w-]{11})(?![\w-])/i);
  return m?.[1] ?? null;
}

/** The database calls room creation needs; implemented with the Firebase JS SDK by the web app and uploader. */
export interface RoomWriter {
  /** Multi-path update at the database root. */
  update(writes: Record<string, unknown>): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * Create a room under a fresh room code. Membership is written first (rules check it against existing
 * data); if the code is already taken (about 1 in 10^12 per room), the membership is undone and
 * another code is tried. A taken code can't be overwritten either way: meta is host-only.
 */
export async function createRoomWithCode(
  room: Omit<NewRoom, "roomId">,
  db: RoomWriter,
  serverTs: object,
  newCode: () => string = generateRoomCode,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = newCode();
    const writes = roomCreationWrites({ ...room, roomId }, serverTs);
    await db.update(writes.membership);
    if (await db.exists(paths.roomMeta(roomId))) {
      await db.update(Object.fromEntries(Object.keys(writes.membership).map((k) => [k, null])));
      continue;
    }
    await db.update(writes.content);
    return roomId;
  }
  throw new Error("Couldn't find a free room code. Try again.");
}
