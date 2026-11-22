"use client";

import { useSyncExternalStore } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { ref, runTransaction, serverTimestamp, set } from "firebase/database";
import { paths } from "@watchparty/shared";
import { firebase } from "./firebase";

export type AuthState =
  | { status: "loading"; user: null }
  | { status: "signedOut"; user: null }
  | { status: "signedIn"; user: User }
  | { status: "error"; user: null; error: string };

// Module-level store so every component shares one onAuthStateChanged subscription.
let state: AuthState = { status: "loading", user: null };
const listeners = new Set<() => void>();
let started = false;

function emit(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started) return;
  started = true;
  try {
    onAuthStateChanged(firebase().auth, (user) => {
      emit(user ? { status: "signedIn", user } : { status: "signedOut", user: null });
      if (user) void ensureUserProfile(user);
    });
  } catch (e) {
    emit({ status: "error", user: null, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Create users/{uid} if it's missing (e.g. the tab closed before signUp's write landed).
 * A transaction so it never clobbers a profile signUp writes concurrently.
 */
async function ensureUserProfile(user: User) {
  try {
    await runTransaction(
      ref(firebase().db, paths.user(user.uid)),
      (current: unknown) =>
        current ?? {
          email: user.email ?? "",
          displayName: displayNameOf(user),
          createdAt: Date.now(),
        },
      { applyLocally: false },
    );
  } catch (e) {
    console.warn("ensureUserProfile failed", e);
  }
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: AuthState = { status: "loading", user: null };

export function useAuth(): AuthState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
}

/** Display name to show for a user (falls back to the email local part). */
export function displayNameOf(user: Pick<User, "displayName" | "email">): string {
  return user.displayName || user.email?.split("@")[0] || "Guest";
}

export async function signIn(email: string, password: string) {
  await signInWithEmailAndPassword(firebase().auth, email, password);
}

export async function signUp(email: string, password: string, displayName: string) {
  const { auth, db } = firebase();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const name = displayName.trim() || email.split("@")[0] || "Guest";
  await updateProfile(cred.user, { displayName: name });
  // updateProfile does not trigger onAuthStateChanged; refresh subscribers right away.
  emit({ status: "signedIn", user: cred.user });
  await set(ref(db, paths.user(cred.user.uid)), {
    email,
    displayName: name,
    createdAt: serverTimestamp(),
  });
}

export async function resetPassword(email: string) {
  await sendPasswordResetEmail(firebase().auth, email);
}

export async function signOut() {
  await fbSignOut(firebase().auth);
}

/** Turn Firebase auth errors into short human messages. */
export function authErrorMessage(e: unknown): string {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try logging in.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection.";
    default:
      return e instanceof Error ? e.message : "Something went wrong.";
  }
}
