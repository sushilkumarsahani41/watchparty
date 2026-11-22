"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  limitToLast,
  onDisconnect,
  onValue,
  orderByChild,
  query,
  ref,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import type { User } from "firebase/auth";
import {
  paths,
  type ChatMessage,
  type PlaybackState,
  type PresenceMap,
  type RoomMeta,
} from "@watchparty/shared";
import { firebase } from "./firebase";
import { forgetRoom, joinRoom } from "./rooms";
import { displayNameOf } from "./useAuth";

export const CHAT_HISTORY = 100;

export type ChatEntry = ChatMessage & { id: string };

export type RoomStatus = "joining" | "ready" | "notFound" | "error";

export interface RoomData {
  status: RoomStatus;
  error: string | null;
  meta: RoomMeta | null;
  state: PlaybackState | null;
  presence: PresenceMap;
  messages: ChatEntry[];
  /** True while the RTDB socket is connected. */
  connected: boolean;
}

/** Joins the room, keeps own presence up to date and subscribes to meta/state/presence/chat. */
export function useRoom(roomId: string, user: User): RoomData & { setBuffering: (b: boolean) => void } {
  const [data, setData] = useState<RoomData>({
    status: "joining",
    error: null,
    meta: null,
    state: null,
    presence: {},
    messages: [],
    connected: false,
  });
  const patch = (p: Partial<RoomData>) => setData((d) => ({ ...d, ...p }));
  const bufferingRef = useRef(false);
  const joinedRef = useRef(false);

  // 1. Join, then subscribe to room data.
  useEffect(() => {
    const { db } = firebase();
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const fail = (e: Error) => {
      if (cancelled) return;
      // After a "not found" we drop membership, so later permission errors are expected.
      setData((d) => (d.status === "notFound" ? d : { ...d, status: "error", error: e.message }));
    };

    (async () => {
      try {
        await joinRoom(roomId, user.uid);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      if (cancelled) return;
      joinedRef.current = true;

      unsubs.push(
        onValue(
          ref(db, paths.roomMeta(roomId)),
          (snap) => {
            if (!snap.exists()) {
              patch({ status: "notFound" });
              void forgetRoom(roomId, user.uid);
              return;
            }
            patch({ status: "ready", meta: snap.val() as RoomMeta });
          },
          fail,
        ),
        onValue(ref(db, paths.roomState(roomId)), (snap) => patch({ state: snap.val() as PlaybackState | null }), fail),
        onValue(ref(db, paths.roomPresence(roomId)), (snap) => patch({ presence: (snap.val() as PresenceMap | null) ?? {} }), fail),
        onValue(
          query(ref(db, paths.chat(roomId)), orderByChild("ts"), limitToLast(CHAT_HISTORY)),
          (snap) => {
            const messages: ChatEntry[] = [];
            snap.forEach((child) => {
              messages.push({ id: child.key ?? "", ...(child.val() as ChatMessage) });
            });
            patch({ messages });
          },
          fail,
        ),
      );
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [roomId, user.uid]);

  // 2. Presence: online while connected, cleared by the server on disconnect.
  //    Only once the room is known to exist (membership is in place by then).
  const ready = data.status === "ready";
  useEffect(() => {
    if (!ready) return;
    const { db } = firebase();
    const presenceRef = ref(db, paths.roomPresenceUser(roomId, user.uid));
    const name = displayNameOf(user);

    const unsub = onValue(ref(db, paths.connected()), async (snap) => {
      const connected = snap.val() === true;
      patch({ connected });
      if (!connected) return;
      try {
        await onDisconnect(presenceRef).update({ online: false, buffering: false, lastSeen: serverTimestamp() });
        await set(presenceRef, { online: true, buffering: bufferingRef.current, name, lastSeen: serverTimestamp() });
      } catch (e) {
        console.warn("presence write failed", e);
      }
    });

    return () => {
      unsub();
      void onDisconnect(presenceRef).cancel().catch(() => {});
      void update(presenceRef, { online: false, buffering: false, lastSeen: serverTimestamp() }).catch(() => {});
    };
  }, [ready, roomId, user]);

  const uid = user.uid;
  const setBuffering = useCallback(
    (buffering: boolean) => {
      if (bufferingRef.current === buffering) return;
      bufferingRef.current = buffering;
      if (!joinedRef.current) return;
      const { db } = firebase();
      void update(ref(db, paths.roomPresenceUser(roomId, uid)), { buffering }).catch(() => {});
    },
    [roomId, uid],
  );

  return { ...data, setBuffering };
}
