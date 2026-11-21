import { describe, expect, it } from "vitest";
import type { PresenceMap } from "./types";
import { bufferingParticipants, decideDrift, effectivePlaying, expectedPosition } from "./sync";

describe("expectedPosition", () => {
  const base = { position: 10, updatedAt: 1_000_000, rate: 1 };

  it("returns position as-is when paused", () => {
    expect(expectedPosition({ ...base, playing: false }, 1_005_000)).toBe(10);
  });

  it("advances by elapsed time when playing", () => {
    expect(expectedPosition({ ...base, playing: true }, 1_005_000)).toBeCloseTo(15);
  });

  it("scales by rate", () => {
    expect(expectedPosition({ ...base, playing: true, rate: 2 }, 1_005_000)).toBeCloseTo(20);
  });

  it("treats rate 0/missing as 1", () => {
    expect(expectedPosition({ ...base, playing: true, rate: 0 }, 1_002_000)).toBeCloseTo(12);
  });

  it("ignores negative elapsed (clock skew)", () => {
    expect(expectedPosition({ ...base, playing: true }, 999_000)).toBe(10);
  });

  it("clamps to duration", () => {
    expect(expectedPosition({ ...base, playing: true }, 1_100_000, 60)).toBe(60);
  });
});

describe("decideDrift", () => {
  it("seeks when drift > 1.5s", () => {
    expect(decideDrift({ currentTime: 20, expected: 10, playing: true, currentRate: 1 })).toEqual({
      action: "seek",
      to: 10,
    });
    expect(decideDrift({ currentTime: 8, expected: 10, playing: false, currentRate: 1 })).toEqual({
      action: "seek",
      to: 10,
    });
  });

  it("slows down when ahead by 0.3-1.5s while playing", () => {
    expect(decideDrift({ currentTime: 10.5, expected: 10, playing: true, currentRate: 1 })).toEqual({
      action: "rate",
      rate: 0.95,
    });
  });

  it("speeds up when behind by 0.3-1.5s while playing", () => {
    expect(decideDrift({ currentTime: 9.5, expected: 10, playing: true, currentRate: 1 })).toEqual({
      action: "rate",
      rate: 1.05,
    });
  });

  it("does not rate-correct while paused", () => {
    expect(decideDrift({ currentTime: 10.5, expected: 10, playing: false, currentRate: 1 })).toEqual({
      action: "none",
    });
  });

  it("returns none when already at the correction rate", () => {
    expect(decideDrift({ currentTime: 10.5, expected: 10, playing: true, currentRate: 0.95 })).toEqual({
      action: "none",
    });
  });

  it("keeps correction rate inside the hysteresis band (0.1-0.3)", () => {
    expect(decideDrift({ currentTime: 10.2, expected: 10, playing: true, currentRate: 0.95 })).toEqual({
      action: "none",
    });
  });

  it("restores rate once drift < 0.1", () => {
    expect(decideDrift({ currentTime: 10.05, expected: 10, playing: true, currentRate: 0.95 })).toEqual({
      action: "rate",
      rate: 1,
    });
  });

  it("restores rate when paused", () => {
    expect(decideDrift({ currentTime: 10.2, expected: 10, playing: false, currentRate: 1.05 })).toEqual({
      action: "rate",
      rate: 1,
    });
  });

  it("does nothing when in sync", () => {
    expect(decideDrift({ currentTime: 10.05, expected: 10, playing: true, currentRate: 1 })).toEqual({
      action: "none",
    });
  });
});

describe("buffering gate", () => {
  const p = (online: boolean, buffering: boolean) => ({ online, buffering, name: "x", lastSeen: 0 });

  it("lists only online buffering participants", () => {
    const presence: PresenceMap = { a: p(true, true), b: p(false, true), c: p(true, false) };
    expect(bufferingParticipants(presence)).toEqual(["a"]);
  });

  it("handles null presence", () => {
    expect(bufferingParticipants(null)).toEqual([]);
    expect(effectivePlaying({ playing: true }, null)).toBe(true);
  });

  it("is false when state is paused", () => {
    expect(effectivePlaying({ playing: false }, {})).toBe(false);
  });

  it("is false when someone online is buffering", () => {
    expect(effectivePlaying({ playing: true }, { a: p(true, true) })).toBe(false);
  });

  it("ignores offline buffering participants", () => {
    expect(effectivePlaying({ playing: true }, { a: p(false, true), b: p(true, false) })).toBe(true);
  });
});
