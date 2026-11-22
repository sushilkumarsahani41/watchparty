"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ref, serverTimestamp, set } from "firebase/database";
import {
  SEEK_THRESHOLD,
  bufferingParticipants,
  decideDrift,
  effectivePlaying,
  expectedPosition,
  paths,
  type PlaybackState,
  type PresenceMap,
} from "@watchparty/shared";
import { firebase } from "./firebase";
import { serverNow, startServerTime } from "./serverTime";

const HEARTBEAT_MS = 5000;
/** How long a programmatic play/pause/seek waits for its media event before the guard expires. */
const GUARD_MS = 1500;
/** Ignore stalls shorter than this so a tiny hiccup doesn't pause everyone. */
const BUFFERING_DEBOUNCE_MS = 400;
/** Collapse rapid seeks (arrow key mashing) into one write. */
const SEEK_WRITE_DEBOUNCE_MS = 250;

type GuardKind = "play" | "pause" | "seek";

interface Params {
  videoRef: RefObject<HTMLVideoElement | null>;
  roomId: string;
  uid: string;
  state: PlaybackState | null;
  presence: PresenceMap;
  durationSec: number;
  setBuffering: (b: boolean) => void;
  /** True once the <video> element is mounted (re-runs event wiring). */
  mounted: boolean;
}

export interface SyncApi {
  /** False until the user clicks "Join & sync" (browser autoplay policy). */
  unlocked: boolean;
  unlock: () => void;
  /** Names of online participants (other than you) we're waiting for. */
  waitingFor: string[];
  selfBuffering: boolean;
}

/**
 * The sync engine. Local play/pause/seek media events become writes to rooms/{id}/state;
 * every state snapshot (and a 5s heartbeat) re-aligns the local player. Programmatic changes
 * are wrapped in a guard so their media events aren't written back (no echo loops).
 */
export function useSync({
  videoRef,
  roomId,
  uid,
  state,
  presence,
  durationSec,
  setBuffering,
  mounted,
}: Params): SyncApi {
  const [unlocked, setUnlocked] = useState(false);
  const [selfBuffering, setSelfBuffering] = useState(false);

  // Latest values for event handlers / timers without re-subscribing.
  const stateRef = useRef(state);
  const presenceRef = useRef(presence);
  const unlockedRef = useRef(false);
  stateRef.current = state;
  presenceRef.current = presence;

  const guards = useRef<Record<GuardKind, number>>({ play: 0, pause: 0, seek: 0 });
  const arm = (kind: GuardKind) => {
    guards.current[kind] = performance.now() + GUARD_MS;
  };
  /** True (and disarms) if this media event was caused by us applying remote state. */
  const consume = (kind: GuardKind) => {
    if (guards.current[kind] > performance.now()) {
      guards.current[kind] = 0;
      return true;
    }
    return false;
  };

  const duration = useCallback(() => {
    const d = videoRef.current?.duration;
    return d && Number.isFinite(d) ? d : durationSec;
  }, [videoRef, durationSec]);

  const writeState = useCallback(
    (playing: boolean, position: number, reason: string) => {
      const prev = stateRef.current;
      if (process.env.NODE_ENV !== "production") {
        console.debug(`[sync] write ${reason}: playing=${playing} pos=${position.toFixed(2)} rev=${(prev?.rev ?? 0) + 1}`);
      }
      void set(ref(firebase().db, paths.roomState(roomId)), {
        playing,
        position,
        updatedAt: serverTimestamp(),
        rate: 1,
        rev: (prev?.rev ?? 0) + 1,
        by: uid,
      }).catch((e) => console.warn("state write failed", e));
    },
    [roomId, uid],
  );

  /** Bring the local player in line with shared state + buffering gate. */
  const reconcile = useCallback(() => {
    const video = videoRef.current;
    const s = stateRef.current;
    if (!video || !s || !unlockedRef.current) return;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const shouldPlay = effectivePlaying(s, presenceRef.current);
    const gated = s.playing && !shouldPlay;

    // While anyone is buffering, everyone holds still; don't chase the advancing clock.
    if (!gated) {
      const expected = expectedPosition(s, serverNow(), duration());
      const decision = decideDrift({
        currentTime: video.currentTime,
        expected,
        playing: shouldPlay,
        currentRate: video.playbackRate,
      });
      if (decision.action === "seek") {
        arm("seek");
        video.currentTime = decision.to;
      } else if (decision.action === "rate") {
        video.playbackRate = decision.rate;
      }
    } else if (video.playbackRate !== 1) {
      video.playbackRate = 1;
    }

    if (shouldPlay && video.paused && !video.ended) {
      arm("play");
      video.play().catch((e: unknown) => {
        guards.current.play = 0;
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          unlockedRef.current = false;
          setUnlocked(false);
        }
      });
    } else if (!shouldPlay && !video.paused) {
      arm("pause");
      video.pause();
    }
  }, [videoRef, duration]);

  useEffect(() => startServerTime(), []);

  // Re-align on every state/presence change.
  useEffect(() => {
    reconcile();
  }, [state, presence, reconcile]);

  // Heartbeat + media event wiring.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let seekWriteTimer: ReturnType<typeof setTimeout> | undefined;
    let bufferingTimer: ReturnType<typeof setTimeout> | undefined;
    let buffering = false;

    const publishBuffering = (b: boolean) => {
      if (buffering === b) return;
      buffering = b;
      setSelfBuffering(b);
      setBuffering(b);
      if (!b) onRecovered();
    };

    /** After we stalled, if we fell well behind, make our position the shared one so nobody skips ahead. */
    const onRecovered = () => {
      const s = stateRef.current;
      if (!s?.playing || !unlockedRef.current) return;
      const expected = expectedPosition(s, serverNow(), duration());
      if (expected - video.currentTime > SEEK_THRESHOLD) writeState(true, video.currentTime, "recovered");
      else reconcile();
    };

    const onPlay = () => {
      if (consume("play") || !unlockedRef.current) return;
      writeState(true, video.currentTime, "play-event");
    };
    const onPause = () => {
      if (consume("pause") || !unlockedRef.current) return;
      // A local pause while the room is gated on buffering is ours, not a user action.
      const s = stateRef.current;
      if (s?.playing && !effectivePlaying(s, presenceRef.current)) return;
      writeState(false, video.currentTime, "pause-event");
    };
    const onSeeked = () => {
      if (consume("seek") || !unlockedRef.current) return;
      clearTimeout(seekWriteTimer);
      seekWriteTimer = setTimeout(() => {
        const s = stateRef.current;
        // Keep the room's play/pause intent; only the position changed.
        writeState(s?.playing ?? !video.paused, video.currentTime, "seeked-event");
      }, SEEK_WRITE_DEBOUNCE_MS);
    };
    const onWaiting = () => {
      if (!unlockedRef.current) return;
      clearTimeout(bufferingTimer);
      bufferingTimer = setTimeout(() => publishBuffering(true), BUFFERING_DEBOUNCE_MS);
    };
    const onReady = () => {
      clearTimeout(bufferingTimer);
      if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) publishBuffering(false);
    };
    const onMetadata = () => reconcile();

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("canplay", onReady);
    video.addEventListener("canplaythrough", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("loadedmetadata", onMetadata);

    const heartbeat = setInterval(() => {
      // Safety net: never leave a stale buffering flag up once data is there.
      if (buffering && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) publishBuffering(false);
      reconcile();
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      clearTimeout(seekWriteTimer);
      clearTimeout(bufferingTimer);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("loadedmetadata", onMetadata);
      if (buffering) setBuffering(false);
    };
  }, [mounted, videoRef, reconcile, writeState, duration, setBuffering]);

  const unlock = useCallback(() => {
    unlockedRef.current = true;
    setUnlocked(true);
    // Runs inside the click handler so play() counts as a user gesture.
    reconcile();
  }, [reconcile]);

  const waitingFor = bufferingParticipants(presence)
    .filter((id) => id !== uid)
    .map((id) => presence[id]?.name ?? "Someone");

  return { unlocked, unlock, waitingFor, selfBuffering };
}
