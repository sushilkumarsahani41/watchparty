import { paths } from "./paths";

export interface NewRoom {
  roomId: string;
  hostUid: string;
  title: string;
  videoId: string;
  hlsUrl: string;
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
        videoId: room.videoId,
        hlsUrl: room.hlsUrl,
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

/** Web invite link: <webBase>/room/<roomId> */
export function inviteLinkFor(webBaseUrl: string, roomId: string): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/room/${roomId}`;
}
