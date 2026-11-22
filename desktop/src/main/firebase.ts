import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut as fbSignOut, type Auth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, push, ref, serverTimestamp, update, type Database } from "firebase/database";
import { roomCreationWrites, type NewRoom } from "@watchparty/shared";
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

/** Same writes as the web app (shared helper): membership first, then meta + initial state. */
export async function createRoom(s: Settings, room: Omit<NewRoom, "roomId" | "hostUid">): Promise<string> {
  const { auth, db } = await fb(s);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in first.");
  const roomId = push(ref(db, "rooms")).key;
  if (!roomId) throw new Error("Could not allocate a room id");
  const writes = roomCreationWrites({ ...room, roomId, hostUid: uid }, serverTimestamp());
  await update(ref(db), writes.membership);
  await update(ref(db), writes.content);
  return roomId;
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
