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
    <section className="border-b border-white/10 px-3 py-2">
      <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
        Watching · {onlineCount} online
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {people.map(([uid, p]) => (
          <li
            key={uid}
            className={`flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs ${
              p.online ? "text-zinc-200" : "text-zinc-500"
            }`}
            title={p.online ? (p.buffering ? "Buffering" : "Online") : "Offline"}
          >
            <span
              className={`size-2 rounded-full ${
                !p.online ? "bg-zinc-600" : p.buffering ? "animate-pulse bg-amber-400" : "bg-emerald-400"
              }`}
            />
            {p.name}
            {uid === selfUid && <span className="text-zinc-500">(you)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
