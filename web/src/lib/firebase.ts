"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";

// Each env var must be referenced literally so Next.js inlines it at build time.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

export const mediaBaseUrl = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "";

let cached: { app: FirebaseApp; auth: Auth; db: Database } | null = null;

/** Lazily initialise Firebase. Client-only: never call during server rendering. */
export function firebase() {
  if (cached) return cached;
  if (typeof window === "undefined") {
    throw new Error("firebase() must only be called in the browser");
  }
  const missing = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Missing Firebase config: ${missing.join(", ")}. Copy web/.env.local.example to web/.env.local and fill it in.`,
    );
  }

  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const db = getDatabase(app);

  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(db, "127.0.0.1", 9000);
  }

  cached = { app, auth, db };
  return cached;
}
