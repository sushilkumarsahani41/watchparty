"use client";

import { get, push, ref, remove, serverTimestamp, set, update } from "firebase/database";
import type { User } from "firebase/auth";
import { paths, roomCreationWrites, type RoomMeta } from "@watchparty/shared";
import { firebase } from "./firebase";

/** Public multi-bitrate HLS stream used until the desktop uploader exists. */
export const TEST_HLS_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
export const TEST_DURATION_SEC = 634;

/** Room ids are RTDB push ids: 20 chars of [-_0-9A-Za-z]. */
const ROOM_ID_RE = /^[-_0-9A-Za-z]{16,40}$/;

/** Accepts a full invite link or a bare room id; returns the id or null. */
export function parseRoomInput(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = trimmed.match(/\/room\/([^/?#\s]+)/)?.[1];
  const id = fromLink ?? trimmed;
  return ROOM_ID_RE.test(id) ? id : null;
}

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

/** Create a room: membership first (rules check it against existing data), then meta + state. */
export async function createRoom(
  user: User,
  opts: { title: string; hlsUrl: string; videoId: string; durationSec: number },
): Promise<string> {
  const { db } = firebase();
  const roomId = push(ref(db, "rooms")).key;
  if (!roomId) throw new Error("Could not allocate a room id");
  const writes = roomCreationWrites({ roomId, hostUid: user.uid, ...opts }, serverTimestamp());
  await update(ref(db), writes.membership);
  await update(ref(db), writes.content);
  return roomId;
}

export function createTestRoom(user: User) {
  return createRoom(user, {
    title: "Test room: Big Buck Bunny",
    hlsUrl: TEST_HLS_URL,
    videoId: "test-bbb",
    durationSec: TEST_DURATION_SEC,
  });
}

/** Read room metas for the "my rooms" list. Rooms that vanished are skipped. */
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
