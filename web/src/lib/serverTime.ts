"use client";

import { onValue, ref } from "firebase/database";
import { paths } from "@watchparty/shared";
import { firebase } from "./firebase";

let offsetMs = 0;
let started = false;

/** Start tracking .info/serverTimeOffset (idempotent). */
export function startServerTime() {
  if (started) return;
  started = true;
  onValue(ref(firebase().db, paths.serverTimeOffset()), (snap) => {
    const v = snap.val();
    if (typeof v === "number") offsetMs = v;
  });
}

/** Best estimate of the Firebase server clock, in ms since epoch. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
