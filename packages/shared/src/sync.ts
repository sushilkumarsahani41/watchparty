import type { PlaybackState, PresenceMap } from "./types";

/** Drift above this (seconds) triggers a hard seek. */
export const SEEK_THRESHOLD = 1.5;
/** Drift above this (seconds) while playing triggers rate correction. */
export const RATE_THRESHOLD = 0.3;
/** Drift below this (seconds) restores normal rate. */
export const RATE_RESTORE_THRESHOLD = 0.1;
export const SLOW_FACTOR = 0.95;
export const FAST_FACTOR = 1.05;

export type ExpectedState = Pick<PlaybackState, "playing" | "position" | "updatedAt" | "rate">;

/**
 * Where the video should be right now, in seconds.
 * @param serverNowMs current server time (Date.now() + .info/serverTimeOffset)
 * @param durationSec optional clamp upper bound
 */
export function expectedPosition(
  state: ExpectedState,
  serverNowMs: number,
  durationSec?: number,
): number {
  let pos = state.position;
  if (state.playing) {
    const elapsedSec = Math.max(0, serverNowMs - state.updatedAt) / 1000;
    pos += elapsedSec * (state.rate || 1);
  }
  pos = Math.max(0, pos);
  if (durationSec !== undefined && durationSec > 0) pos = Math.min(pos, durationSec);
  return pos;
}

export type DriftDecision =
  | { action: "none" }
  | { action: "seek"; to: number }
  | { action: "rate"; rate: number };

/**
 * Decide how to correct the local player.
 * - |drift| > 1.5s           -> seek to expected
 * - paused && |drift| > 0.3  -> seek to expected (invisible while paused)
 * - playing && |drift| > 0.3 -> nudge playbackRate (0.95 if ahead, 1.05 if behind)
 * - corrected && (|drift| < 0.1 or drift crossed zero) -> restore base rate
 * Between 0.1 and 0.3 the current rate is kept (hysteresis).
 */
export function decideDrift(params: {
  currentTime: number;
  expected: number;
  playing: boolean;
  currentRate: number;
  baseRate?: number;
}): DriftDecision {
  const baseRate = params.baseRate ?? 1;
  const drift = params.currentTime - params.expected;
  const abs = Math.abs(drift);

  if (abs > SEEK_THRESHOLD) return { action: "seek", to: params.expected };
  // While paused a seek is invisible, so align tightly instead of leaving it to rate correction later.
  if (!params.playing && abs > RATE_THRESHOLD) return { action: "seek", to: params.expected };

  if (params.playing && abs > RATE_THRESHOLD) {
    const rate = baseRate * (drift > 0 ? SLOW_FACTOR : FAST_FACTOR);
    return params.currentRate === rate ? { action: "none" } : { action: "rate", rate };
  }

  const isCorrecting = params.currentRate !== baseRate;
  // Crossed the target (sped up but now ahead, or slowed down but now behind): stop before overshooting.
  const overshot = (params.currentRate > baseRate && drift > 0) || (params.currentRate < baseRate && drift < 0);
  if (isCorrecting && (abs < RATE_RESTORE_THRESHOLD || overshot || !params.playing)) {
    return { action: "rate", rate: baseRate };
  }
  return { action: "none" };
}

/** uids of online participants currently buffering. */
export function bufferingParticipants(presence: PresenceMap | null | undefined): string[] {
  if (!presence) return [];
  return Object.entries(presence)
    .filter(([, p]) => p.online && p.buffering)
    .map(([uid]) => uid);
}

/** Effective playing = shared state says playing AND no online participant is buffering. */
export function effectivePlaying(
  state: Pick<PlaybackState, "playing"> | null | undefined,
  presence: PresenceMap | null | undefined,
): boolean {
  if (!state?.playing) return false;
  return bufferingParticipants(presence).length === 0;
}
