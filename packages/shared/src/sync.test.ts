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

describe("room helpers", async () => {
  const { roomCreationWrites, hlsUrlFor, inviteLinkFor } = await import("./rooms");
  it("orders membership before content and stamps server time", () => {
    const ts = { ".sv": "timestamp" };
    const w = roomCreationWrites({ roomId: "r1", hostUid: "u1", title: "T", videoId: "v1", hlsUrl: "h", durationSec: 5 }, ts);
    expect(Object.keys(w.membership)).toEqual(["roomMembers/r1/u1", "userRooms/u1/r1"]);
    expect(w.content["rooms/r1/state"]).toMatchObject({ playing: false, position: 0, rev: 0, by: "u1", updatedAt: ts });
    expect(w.content["rooms/r1/meta"]).toMatchObject({ hostUid: "u1", createdAt: ts, hlsUrl: "h" });
  });
  it("builds URLs without double slashes", () => {
    expect(hlsUrlFor("https://media.x.com/", "abc")).toBe("https://media.x.com/videos/abc/master.m3u8");
    expect(inviteLinkFor("https://w.x.com//", "r1")).toBe("https://w.x.com/room/r1");
  });
});
