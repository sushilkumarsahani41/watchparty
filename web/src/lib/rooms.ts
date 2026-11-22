"use client";

import { get, ref, remove, serverTimestamp, set, update } from "firebase/database";
import type { User } from "firebase/auth";
import { createRoomWithCode, paths, roomDeletionWrites, type NewRoom, type RoomMeta } from "@watchparty/shared";
import { firebase } from "./firebase";

export { parseRoomInput, parseYouTubeId, formatRoomCode } from "@watchparty/shared";

/** Public multi-bitrate HLS stream for trying the app without uploading anything. */
export const TEST_HLS_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
export const TEST_DURATION_SEC = 634;

export function inviteLink(roomId: string): string {
  return `${window.location.origin}/room/${roomId}`;
}

/** Self-join: membership must exist before any rooms/* or chats/* read is allowed. */
export async function joinRoom(roomId: string, uid: string) {
  const { db } = firebase();
  await set(ref(db, paths.roomMember(roomId, uid)), true);
  await set(ref(db, paths.userRoom(uid, roomId)), true);
}

/** Undo a join (used when the link points to a room that doesn't exist). */
export async function forgetRoom(roomId: string, uid: string) {
  const { db } = firebase();
  await Promise.allSettled([
    remove(ref(db, paths.roomMember(roomId, uid))),
    remove(ref(db, paths.userRoom(uid, roomId))),
  ]);
}

/** Create a room under a fresh 8-character room code. */
export async function createRoom(user: User, room: Omit<NewRoom, "roomId" | "hostUid">): Promise<string> {
  const { db } = firebase();
  return createRoomWithCode(
    { ...room, hostUid: user.uid },
    { update: (w) => update(ref(db), w), exists: async (p) => (await get(ref(db, p))).exists() },
    serverTimestamp(),
  );
}

export function createTestRoom(user: User) {
  return createRoom(user, {
    title: "Test room: Big Buck Bunny",
    source: "hls",
    hlsUrl: TEST_HLS_URL,
    videoId: "test-bbb",
    durationSec: TEST_DURATION_SEC,
  });
}

/** Title (and a check that it exists and may be embedded) via YouTube oEmbed, which allows CORS. */
export async function youTubeInfo(youtubeId: string): Promise<{ title: string }> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeId}`)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    // Network or blocked request: create the room anyway; the player reports real problems.
    return { title: "YouTube video" };
  }
  if (res.status === 401 || res.status === 403) throw new Error("The owner of this video doesn't allow playing it outside YouTube.");
  if (res.status === 404 || res.status === 400) throw new Error("That YouTube video doesn't exist or is private.");
  if (!res.ok) return { title: "YouTube video" };
  const data = (await res.json()) as { title?: string };
  return { title: data.title?.trim() || "YouTube video" };
}

export async function createYouTubeRoom(user: User, youtubeId: string): Promise<string> {
  const { title } = await youTubeInfo(youtubeId);
  return createRoom(user, { title, source: "youtube", youtubeId, videoId: "", hlsUrl: "", durationSec: 0 });
}

/** Delete a room you host: everyone is removed and its chat is deleted. Uploaded files stay on R2. */
export async function deleteRoom(roomId: string, uid: string) {
  await update(ref(firebase().db), roomDeletionWrites(roomId, uid));
}

/** Read room metas for the "my rooms" list. Rooms that vanished (or were deleted) are skipped. */
export async function loadRoomMetas(roomIds: string[]): Promise<Array<{ id: string; meta: RoomMeta }>> {
  const { db } = firebase();
  const results = await Promise.allSettled(
    roomIds.map(async (id) => ({ id, snap: await get(ref(db, paths.roomMeta(id))) })),
  );
  return results
    .flatMap((r) => (r.status === "fulfilled" && r.value.snap.exists() ? [r.value] : []))
    .map(({ id, snap }) => ({ id, meta: snap.val() as RoomMeta }))
    .sort((a, b) => (b.meta.createdAt ?? 0) - (a.meta.createdAt ?? 0));
}
