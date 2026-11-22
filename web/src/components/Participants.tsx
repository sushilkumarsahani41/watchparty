"use client";

import type { PresenceMap } from "@watchparty/shared";

export function Participants({ presence, selfUid }: { presence: PresenceMap; selfUid: string }) {
  const people = Object.entries(presence).sort(([aUid, a], [bUid, b]) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (aUid === selfUid) return -1;
    if (bUid === selfUid) return 1;
    return a.name.localeCompare(b.name);
  });
  const onlineCount = people.filter(([, p]) => p.online).length;

  return (
    <section className="border-b border-line px-4 py-3">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        Watching · {onlineCount} online
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {people.map(([uid, p]) => (
          <li
            key={uid}
            className={`flex items-center gap-2 rounded-full border border-line bg-surface-2 py-1 pl-1 pr-3 text-xs ${p.online ? "text-fg" : "text-faint"}`}
            title={p.online ? (p.buffering ? "Buffering" : "Online") : "Offline"}
          >
            <span className="relative grid size-6 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold">
              {p.name.slice(0, 1).toUpperCase()}
              <span
                className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface-2 ${
                  !p.online ? "bg-zinc-600" : p.buffering ? "animate-pulse bg-amber-400" : "bg-emerald-400"
                }`}
              />
            </span>
            {p.name}
            {uid === selfUid && <span className="text-faint">you</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
