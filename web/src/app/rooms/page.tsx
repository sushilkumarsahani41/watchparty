"use client";

import { useEffect, useState, type FormEvent } from "react";
import { onValue, ref } from "firebase/database";
import type { User } from "firebase/auth";
import { paths, type RoomMeta } from "@watchparty/shared";
import { AuthGate } from "@/components/AuthGate";
import { ArrowRightIcon, CheckIcon, FilmIcon, LinkIcon, TrashIcon, Wordmark, YouTubeIcon } from "@/components/Icons";
import { firebase } from "@/lib/firebase";
import { useGo } from "@/lib/nav";
import {
  createTestRoom,
  createYouTubeRoom,
  deleteRoom,
  formatRoomCode,
  inviteLink,
  loadRoomMetas,
  parseRoomInput,
  parseYouTubeId,
} from "@/lib/rooms";
import { displayNameOf, signOut } from "@/lib/useAuth";

export default function RoomsPage() {
  return <AuthGate>{(user) => <RoomsView user={user} />}</AuthGate>;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function errText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function RoomsView({ user }: { user: User }) {
  const go = useGo();
  const [rooms, setRooms] = useState<Array<{ id: string; meta: RoomMeta }> | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [ytInput, setYtInput] = useState("");
  const [ytError, setYtError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"yt" | "test" | null>(null);

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
      setJoinError("Enter an 8-character room code like ABCD-2345, or paste an invite link.");
      return;
    }
    go(`/room/${id}`);
  }

  async function onCreateYouTube(e: FormEvent) {
    e.preventDefault();
    const id = parseYouTubeId(ytInput);
    if (!id) {
      setYtError("Paste a YouTube link, like https://youtu.be/… or https://www.youtube.com/watch?v=…");
      return;
    }
    setBusy("yt");
    setYtError(null);
    try {
      go(`/room/${await createYouTubeRoom(user, id)}`);
    } catch (err) {
      setYtError(errText(err, "Couldn't create the room."));
      setBusy(null);
    }
  }

  async function onCreateTest() {
    setBusy("test");
    setYtError(null);
    try {
      go(`/room/${await createTestRoom(user)}`);
    } catch (err) {
      setYtError(errText(err, "Couldn't create the room."));
      setBusy(null);
    }
  }

  const name = displayNameOf(user);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-5 sm:px-6 sm:pt-7">
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-3 text-xs font-semibold">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden truncate text-sm text-muted sm:block">{name}</span>
          <button onClick={() => void signOut()} className="btn-ghost px-3 py-2">
            Sign out
          </button>
        </div>
      </header>

      <section className="mt-10 sm:mt-14">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Hey {name.split(" ")[0]} <span className="inline-block origin-[70%_70%] animate-[wave_2s_ease-in-out_1]">👋</span>
        </h1>
        <p className="mt-2 text-muted">Join a room with its code, or start a new watch party.</p>
      </section>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <form onSubmit={onJoin} className="card flex flex-col p-5">
          <h2 className="font-semibold">Join a room</h2>
          <p className="mt-1 text-sm text-faint">Room code or invite link</p>
          <input
            value={joinInput}
            onChange={(e) => {
              setJoinInput(e.target.value);
              setJoinError(null);
            }}
            placeholder="ABCD-2345"
            aria-label="Room code or invite link"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="field mt-4 font-mono text-base uppercase tracking-[0.18em] placeholder:normal-case placeholder:tracking-[0.18em]"
          />
          {joinError && <p className="mt-2 text-sm text-danger">{joinError}</p>}
          <button className="btn-primary mt-3">
            Join <ArrowRightIcon size={16} />
          </button>
        </form>

        <form onSubmit={onCreateYouTube} className="card flex flex-col p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <YouTubeIcon size={18} className="text-red-400" /> YouTube party
          </h2>
          <p className="mt-1 text-sm text-faint">Watch any YouTube video together</p>
          <input
            value={ytInput}
            onChange={(e) => {
              setYtInput(e.target.value);
              setYtError(null);
            }}
            placeholder="https://youtu.be/…"
            aria-label="YouTube link"
            autoComplete="off"
            spellCheck={false}
            className="field mt-4"
          />
          {ytError && <p className="mt-2 text-sm text-danger">{ytError}</p>}
          <button className="btn-secondary mt-3" disabled={busy !== null}>
            {busy === "yt" ? "Creating…" : "Create room"}
          </button>
        </form>
      </div>
      <p className="mt-3 text-center text-xs text-faint">
        Your own videos: upload them with the WatchParty desktop uploader. Just exploring?{" "}
        <button onClick={() => void onCreateTest()} disabled={busy !== null} className="text-muted underline-offset-2 hover:text-fg hover:underline">
          {busy === "test" ? "Creating…" : "Open a demo room"}
        </button>
      </p>

      <section className="mt-12">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Your rooms</h2>
          {rooms && rooms.length > 0 && <span className="text-sm text-faint">{rooms.length}</span>}
        </div>

        {rooms === null ? (
          <div className="card space-y-px overflow-hidden">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-4">
                <div className="size-10 animate-pulse rounded-xl bg-surface-3" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-surface-3" />
                  <div className="h-2.5 w-1/4 animate-pulse rounded bg-surface-2" />
                </div>
              </div>
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong p-10 text-center text-sm text-muted">
            No rooms yet. Join one with a code, or start a YouTube party above.
          </div>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {rooms.map(({ id, meta }) => (
              <RoomRow
                key={id}
                id={id}
                meta={meta}
                isHost={meta.hostUid === user.uid}
                onOpen={() => go(`/room/${id}`)}
                onDelete={async () => {
                  await deleteRoom(id, user.uid);
                  setRooms((cur) => cur?.filter((r) => r.id !== id) ?? null);
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RoomRow({
  id,
  meta,
  isHost,
  onOpen,
  onDelete,
}: {
  id: string;
  meta: RoomMeta;
  isHost: boolean;
  onOpen: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const youtube = meta.source === "youtube";

  return (
    <li className="group flex items-center gap-3 px-3 py-3 transition hover:bg-white/[0.025] sm:px-4">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 ${youtube ? "text-red-400" : "text-accent"}`}>
          {youtube ? <YouTubeIcon size={19} /> : <FilmIcon size={19} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{meta.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            <span className="rounded-full bg-accent-strong/15 px-2 py-px font-mono text-[11px] font-semibold tracking-wider text-accent">
              {formatRoomCode(id)}
            </span>
            <span>{isHost ? "Hosted by you" : "Joined"}</span>
            {typeof meta.createdAt === "number" && <span>· {dateFmt.format(meta.createdAt)}</span>}
          </span>
          {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
        </span>
      </button>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <span className="hidden text-xs text-muted sm:inline">Delete for everyone?</span>
          <button onClick={() => setConfirming(false)} disabled={deleting} className="btn-ghost px-2.5 py-1.5 text-xs">
            Cancel
          </button>
          <button
            onClick={async () => {
              setDeleting(true);
              setError(null);
              try {
                await onDelete();
              } catch (e) {
                setError(errText(e, "Couldn't delete the room."));
                setDeleting(false);
                setConfirming(false);
              }
            }}
            disabled={deleting}
            className="btn px-2.5 py-1.5 text-xs text-danger hover:bg-red-500/10"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(inviteLink(id));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            title="Copy invite link"
            aria-label="Copy invite link"
            className="btn-ghost size-9 p-0"
          >
            {copied ? <CheckIcon size={16} className="text-emerald-300" /> : <LinkIcon size={16} />}
          </button>
          {isHost && (
            <button onClick={() => setConfirming(true)} title="Delete room" aria-label="Delete room" className="btn-ghost size-9 p-0 hover:text-danger">
              <TrashIcon size={16} />
            </button>
          )}
        </span>
      )}
    </li>
  );
}
