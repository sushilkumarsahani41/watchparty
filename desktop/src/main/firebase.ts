import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut as fbSignOut, type Auth } from "firebase/auth";
import { connectDatabaseEmulator, get, getDatabase, ref, serverTimestamp, update, type Database } from "firebase/database";
import { createRoomWithCode, paths, roomDeletionWrites, type NewRoom, type RoomMeta } from "@watchparty/shared";
import type { Settings } from "./settings";

let current: { app: FirebaseApp; auth: Auth; db: Database; key: string } | null = null;

/** (Re)initialise Firebase when the config changes. Runs in the main process (Node). */
async function fb(s: Settings) {
  const key = [s.firebaseApiKey, s.firebaseDatabaseUrl, s.firebaseProjectId].join("|");
  if (current?.key === key) return current;
  if (current) await deleteApp(current.app);
  const app = initializeApp(
    {
      apiKey: s.firebaseApiKey,
      authDomain: s.firebaseAuthDomain,
      databaseURL: s.firebaseDatabaseUrl,
      projectId: s.firebaseProjectId,
      appId: s.firebaseAppId,
    },
    `watchparty-desktop-${Date.now()}`,
  );
  current = { app, auth: getAuth(app), db: getDatabase(app), key };
  if (process.env.WATCHPARTY_USE_EMULATORS === "true") {
    // Dev/testing only: local Firebase emulators.
    connectAuthEmulator(current.auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(current.db, "127.0.0.1", 9000);
  }
  return current;
}

export interface SignedIn {
  uid: string;
  email: string;
  displayName: string;
}

export async function signIn(s: Settings, email: string, password: string): Promise<SignedIn> {
  const { auth } = await fb(s);
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  return {
    uid: user.uid,
    email: user.email ?? email,
    displayName: user.displayName || (user.email ?? email).split("@")[0] || "You",
  };
}

export async function signOut() {
  if (current) await fbSignOut(current.auth);
}

export function currentUid(): string | null {
  return current?.auth.currentUser?.uid ?? null;
}

/** Same writes as the web app (shared helper): a fresh room code, membership first, then meta + state. */
export async function createRoom(s: Settings, room: Omit<NewRoom, "roomId" | "hostUid">): Promise<string> {
  const { auth, db } = await fb(s);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in first.");
  return createRoomWithCode(
    { ...room, source: "hls", hostUid: uid },
    { update: (w) => update(ref(db), w), exists: async (p) => (await get(ref(db, p))).exists() },
    serverTimestamp(),
  );
}

export interface HostedRoom {
  roomId: string;
  meta: RoomMeta;
}

/** Rooms the signed-in user hosts (from their "my rooms" list), newest first. */
export async function listHostedRooms(s: Settings): Promise<HostedRoom[]> {
  const { auth, db } = await fb(s);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in first.");
  const ids = Object.keys(((await get(ref(db, paths.userRooms(uid)))).val() ?? {}) as Record<string, unknown>);
  const rooms = await Promise.all(
    ids.map(async (roomId) => {
      // Rooms deleted elsewhere are no longer readable: skip them.
      const snap = await get(ref(db, paths.roomMeta(roomId))).catch(() => null);
      const meta = snap?.exists() ? (snap.val() as RoomMeta) : null;
      return meta && meta.hostUid === uid ? { roomId, meta } : null;
    }),
  );
  return rooms.filter((r): r is HostedRoom => r !== null).sort((a, b) => (b.meta.createdAt ?? 0) - (a.meta.createdAt ?? 0));
}

/** Delete a room the signed-in user hosts (rules allow only the host). */
export async function deleteRoom(s: Settings, roomId: string): Promise<void> {
  const { auth, db } = await fb(s);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in first.");
  await update(ref(db), roomDeletionWrites(roomId, uid));
}

export function authErrorMessage(e: unknown): string {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found")
    return "Email or password is incorrect.";
  if (code === "auth/invalid-email") return "That email address doesn't look right.";
  if (code === "auth/network-request-failed") return "Network error. Check your connection.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a minute and try again.";
  if (code === "auth/invalid-api-key") return "Firebase settings look wrong (invalid API key).";
  return e instanceof Error ? e.message : "Something went wrong.";
}
