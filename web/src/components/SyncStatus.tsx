"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaybackState, PresenceMap } from "@watchparty/shared";
import { formatTime } from "@/lib/format";

/** Small pill over the video: who we're waiting for, or who just paused/played/seeked. */
export function SyncStatus({
  waitingFor,
  selfBuffering,
  state,
  presence,
  selfUid,
}: {
  waitingFor: string[];
  selfBuffering: boolean;
  state: PlaybackState | null;
  presence: PresenceMap;
  selfUid: string;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const last = useRef<PlaybackState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Announce actions by other people.
  useEffect(() => {
    if (!state) return;
    const prev = last.current;
    last.current = state;
    if (!prev || state.rev === prev.rev || state.by === selfUid) return;
    const who = presence[state.by]?.name ?? "Someone";
    const verb = state.playing === prev.playing ? "jumped to" : state.playing ? "played at" : "paused at";
    setToast(`${who} ${verb} ${formatTime(state.position)}`);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
    // presence intentionally omitted: only re-run when the state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selfUid]);

  let text: string | null = null;
  let tone = "border-white/10 bg-black/60 text-white";
  if (waitingFor.length) {
    text = `${listNames(waitingFor)} ${waitingFor.length === 1 ? "is" : "are"} buffering…`;
    tone = "border-amber-300/30 bg-amber-400/90 text-black";
  } else if (selfBuffering) {
    text = "Buffering…";
  } else if (toast) {
    text = toast;
  }
  if (!text) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2" role="status" aria-live="polite">
      <div className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md ${tone}`}>
        {(waitingFor.length > 0 || selfBuffering) && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {text}
      </div>
    </div>
  );
}

function listNames(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
