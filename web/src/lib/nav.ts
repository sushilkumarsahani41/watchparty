"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Navigate within the app. Room pages are one static page served for every /room/<code> URL, so the
 * router has no prebuilt data for them: those use a full page load (also gives each room a fresh player).
 */
export function useGo() {
  const router = useRouter();
  return useCallback(
    (path: string, opts?: { replace?: boolean }) => {
      if (path.startsWith("/room/")) {
        if (opts?.replace) window.location.replace(path);
        else window.location.assign(path);
      } else if (opts?.replace) router.replace(path);
      else router.push(path);
    },
    [router],
  );
}
