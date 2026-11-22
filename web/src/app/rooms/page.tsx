"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { onValue, ref } from "firebase/database";
import type { User } from "firebase/auth";
import { paths, type RoomMeta } from "@watchparty/shared";
import { AuthGate } from "@/components/AuthGate";
import { firebase } from "@/lib/firebase";
import { createTestRoom, loadRoomMetas, parseRoomInput } from "@/lib/rooms";
import { displayNameOf, signOut } from "@/lib/useAuth";

export default function RoomsPage() {
  return <AuthGate>{(user) => <RoomsView user={user} />}</AuthGate>;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function RoomsView({ user }: { user: User }) {
  const router = useRouter();
  const [rooms, setRooms] = useState<Array<{ id: string; meta: RoomMeta }> | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const unsub = onValue(
      ref(firebase().db, paths.userRooms(user.uid)),
      async (snap) => {
        const ids = Object.keys((snap.val() as Record<string, true> | null) ?? {});
        const metas = await loadRoomMetas(ids);
        if (alive) setRooms(metas);
      },
      () => alive && setRooms([]),
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [user.uid]);

  function onJoin(e: FormEvent) {
    e.preventDefault();
    const id = parseRoomInput(joinInput);
    if (!id) {
      setJoinError("Paste an invite link like …/room/abc123 or a room code.");
      return;
    }
    router.push(`/room/${id}`);
  }

  async function onCreateTest() {
    setCreating(true);
    setCreateError(null);
    try {
      const id = await createTestRoom(user);
      router.push(`/room/${id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create the room.");
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          Watch<span className="text-accent">Party</span>
        </h1>
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <span className="truncate text-zinc-400">{displayNameOf(user)}</span>
          <button
            onClick={() => void signOut()}
            className="rounded-lg border border-white/10 px-3 py-1.5 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      </header>

      <form onSubmit={onJoin} className="mt-8 flex flex-col gap-2 sm:flex-row">
        <input
          value={joinInput}
          onChange={(e) => {
            setJoinInput(e.target.value);
            setJoinError(null);
          }}
          placeholder="Paste invite link or room code"
          aria-label="Invite link or room code"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 outline-none placeholder:text-zinc-600 focus:border-accent"
        />
        <button className="rounded-lg bg-accent-strong px-4 py-2 font-medium text-white hover:bg-accent">Join</button>
      </form>
      {joinError && <p className="mt-2 text-sm text-red-300">{joinError}</p>}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-medium">Your rooms</h2>
          <button
            onClick={() => void onCreateTest()}
            disabled={creating}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            {creating ? "Creating…" : "+ Test room"}
          </button>
        </div>
        {createError && <p className="mb-3 text-sm text-red-300">{createError}</p>}

        {rooms === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : rooms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-400">
            No rooms yet. Open an invite link from a friend, or upload a video with the desktop app.
          </div>
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
            {rooms.map(({ id, meta }) => (
              <li key={id}>
                <Link href={`/room/${id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.03]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{meta.title}</span>
                    <span className="text-xs text-zinc-500">
                      {meta.hostUid === user.uid ? "Hosted by you" : "Joined"}
                      {typeof meta.createdAt === "number" && ` · ${dateFmt.format(meta.createdAt)}`}
                    </span>
                  </span>
                  <span className="text-zinc-500">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
