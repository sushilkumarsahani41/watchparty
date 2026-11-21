/** RTDB path builders. Keep every path string in this file. */
export const paths = {
  user: (uid: string) => `users/${uid}`,
  userRooms: (uid: string) => `userRooms/${uid}`,
  userRoom: (uid: string, roomId: string) => `userRooms/${uid}/${roomId}`,
  roomMembers: (roomId: string) => `roomMembers/${roomId}`,
  roomMember: (roomId: string, uid: string) => `roomMembers/${roomId}/${uid}`,
  room: (roomId: string) => `rooms/${roomId}`,
  roomMeta: (roomId: string) => `rooms/${roomId}/meta`,
  roomState: (roomId: string) => `rooms/${roomId}/state`,
  roomPresence: (roomId: string) => `rooms/${roomId}/presence`,
  roomPresenceUser: (roomId: string, uid: string) => `rooms/${roomId}/presence/${uid}`,
  chat: (roomId: string) => `chats/${roomId}`,
  serverTimeOffset: () => `.info/serverTimeOffset`,
  connected: () => `.info/connected`,
} as const;
