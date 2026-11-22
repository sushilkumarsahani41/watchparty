import { describe, expect, it } from "vitest";
import type { PresenceMap } from "./types";
import { bufferingParticipants, decideDrift, effectivePlaying, expectedPosition } from "./sync";
import vectors from "./sync.vectors.json";

type PresenceLite = Record<string, { online: boolean; buffering: boolean }> | null;

const toPresence = (p: PresenceLite): PresenceMap | null =>
  p &&
  Object.fromEntries(Object.entries(p).map(([uid, v]) => [uid, { ...v, name: uid, lastSeen: 0 }]));

describe("expectedPosition", () => {
  for (const v of vectors.expectedPosition) {
    it(v.name, () => {
      const durationSec = "durationSec" in v ? v.durationSec : undefined;
      expect(expectedPosition(v.state, v.now, durationSec)).toBeCloseTo(v.expected, 9);
    });
  }
});

describe("decideDrift", () => {
  for (const v of vectors.decideDrift) {
    it(v.name, () => {
      expect(decideDrift(v.input)).toEqual(v.result);
    });
  }
});

describe("buffering gate", () => {
  for (const v of vectors.bufferingGate) {
    it(v.name, () => {
      const presence = toPresence(v.presence as PresenceLite);
      expect(bufferingParticipants(presence)).toEqual(v.buffering);
      expect(effectivePlaying({ playing: v.statePlaying }, presence)).toBe(v.effectivePlaying);
    });
  }
});
