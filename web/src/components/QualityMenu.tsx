"use client";

import { useEffect, useRef, useState } from "react";

export interface QualityLevel {
  /** hls.js level index */
  index: number;
  height: number;
  bitrate: number;
}

/** Per-viewer quality picker (not synced). `selected` = -1 means Auto (ABR). */
export function QualityMenu({
  levels,
  selected,
  activeHeight,
  onSelect,
}: {
  levels: QualityLevel[];
  selected: number;
  activeHeight: number | null;
  onSelect: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (levels.length < 2) return null;

  // One entry per height (keep the highest bitrate), tallest first.
  const byHeight = new Map<number, QualityLevel>();
  for (const l of levels) {
    const cur = byHeight.get(l.height);
    if (!cur || l.bitrate > cur.bitrate) byHeight.set(l.height, l);
  }
  const options = [...byHeight.values()].sort((a, b) => b.height - a.height);
  const label =
    selected === -1 ? `Auto${activeHeight ? ` (${activeHeight}p)` : ""}` : `${levels.find((l) => l.index === selected)?.height ?? "?"}p`;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-7 rounded-md border border-white/15 px-2 text-[11px] font-semibold tracking-wide text-white/90 transition hover:bg-white/10"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Quality"
      >
        {label}
      </button>
      {open && (
        <ul role="menu" className="absolute bottom-full right-0 mb-2 min-w-32 overflow-hidden rounded-xl border border-white/10 bg-surface-2/95 p-1 text-sm shadow-2xl backdrop-blur-md">
          {[{ index: -1, text: "Auto" }, ...options.map((o) => ({ index: o.index, text: `${o.height}p` }))].map((o) => (
            <li key={o.index}>
              <button
                role="menuitemradio"
                aria-checked={selected === o.index}
                onClick={() => {
                  onSelect(o.index);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-1.5 text-left hover:bg-white/10 ${
                  selected === o.index ? "text-accent" : ""
                }`}
              >
                {o.text}
                {selected === o.index && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
