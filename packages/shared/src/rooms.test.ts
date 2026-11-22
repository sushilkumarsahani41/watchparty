import { describe, expect, it } from "vitest";
import vectors from "./rooms.vectors.json";
import { createRoomWithCode, formatRoomCode, generateRoomCode, parseRoomInput, parseYouTubeId, ROOM_CODE_ALPHABET, roomCreationWrites, roomDeletionWrites } from "./rooms";

describe("room codes", () => {
  it.each(vectors.parseRoomInput)("parseRoomInput($input)", ({ input, expected }) => {
    expect(parseRoomInput(input)).toBe(expected);
  });

  it.each(vectors.formatRoomCode)("formatRoomCode($input)", ({ input, expected }) => {
    expect(formatRoomCode(input)).toBe(expected);
  });

  it("generates 8 characters from the alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z0-9]{8}$/);
      for (const c of code) expect(ROOM_CODE_ALPHABET).toContain(c);
      expect(parseRoomInput(code)).toBe(code);
    }
  });

  it("maps bytes onto the alphabet without look-alike characters", () => {
    expect(generateRoomCode(() => new Uint8Array([0, 31, 32, 255, 8, 9, 23, 24]))).toBe("A9A9JKZ2");
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01OI]/);
  });
});

describe("roomDeletionWrites", () => {
  it("clears the room, members, chat and the host's entry", () => {
    expect(roomDeletionWrites("ABCD2345", "u1")).toEqual({
      "rooms/ABCD2345": null,
      "roomMembers/ABCD2345": null,
      "chats/ABCD2345": null,
      "userRooms/u1/ABCD2345": null,
    });
  });
});

describe("YouTube", () => {
  it.each(vectors.parseYouTubeId)("parseYouTubeId($input)", ({ input, expected }) => {
    expect(parseYouTubeId(input)).toBe(expected);
  });

  it("creates YouTube rooms with source and id", () => {
    const w = roomCreationWrites(
      { roomId: "ABCD2345", hostUid: "u1", title: "T", source: "youtube", videoId: "", hlsUrl: "", youtubeId: "dQw4w9WgXcQ", durationSec: 0 },
      { ".sv": "timestamp" },
    );
    expect(w.content["rooms/ABCD2345/meta"]).toMatchObject({ source: "youtube", youtubeId: "dQw4w9WgXcQ", hlsUrl: "" });
  });

  it("marks uploaded rooms as hls", () => {
    const w = roomCreationWrites(
      { roomId: "ABCD2345", hostUid: "u1", title: "T", videoId: "v", hlsUrl: "h", durationSec: 1 },
      { ".sv": "timestamp" },
    );
    expect(w.content["rooms/ABCD2345/meta"]).toMatchObject({ source: "hls" });
    expect(w.content["rooms/ABCD2345/meta"]).not.toHaveProperty("youtubeId");
  });
});

describe("createRoomWithCode", () => {
  const room = { hostUid: "u1", title: "T", videoId: "v", hlsUrl: "h", durationSec: 1 };

  it("writes membership, then content, under the new code", async () => {
    const log: string[] = [];
    const id = await createRoomWithCode(
      room,
      { update: async (w) => void log.push(Object.keys(w).sort().join(",")), exists: async () => false },
      {},
      () => "ABCD2345",
    );
    expect(id).toBe("ABCD2345");
    expect(log).toEqual(["roomMembers/ABCD2345/u1,userRooms/u1/ABCD2345", "rooms/ABCD2345/meta,rooms/ABCD2345/state"]);
  });

  it("undoes the membership and retries when the code is taken", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const codes = ["TAKEN234", "FREE2345"];
    const id = await createRoomWithCode(
      room,
      { update: async (w) => void writes.push(w), exists: async (p) => p.includes("TAKEN234") },
      {},
      () => codes.shift()!,
    );
    expect(id).toBe("FREE2345");
    expect(writes[1]).toEqual({ "roomMembers/TAKEN234/u1": null, "userRooms/u1/TAKEN234": null });
    expect(Object.keys(writes[3]!)).toContain("rooms/FREE2345/meta");
  });
});
