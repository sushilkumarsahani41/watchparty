"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { AuthGate, FullScreenMessage } from "@/components/AuthGate";
import { ChatPanel } from "@/components/ChatPanel";
import { ArrowLeftIcon, CheckIcon, CopyIcon, LinkIcon, PlayIcon } from "@/components/Icons";
import { Participants } from "@/components/Participants";
import { Player, type PlayerSource } from "@/components/Player";
import { SyncStatus } from "@/components/SyncStatus";
import type { MediaLike } from "@/lib/media";
import { formatRoomCode, inviteLink, parseRoomInput } from "@/lib/rooms";
import { useRoom } from "@/lib/useRoom";
import { useSync } from "@/lib/useSync";

/** Room code from the URL: /room/<code> (the host serves this page for every room). */
function useRoomIdFromUrl(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const fromPath = window.location.pathname.match(/^\/room\/([^/?#]+)/)?.[1];
    const fromQuery = new URLSearchParams(window.location.search).get("id");
    setId(parseRoomInput(decodeURIComponent(fromPath ?? fromQuery ?? "")));
  }, []);
  return id;
}

export default function RoomPage() {
  const roomId = useRoomIdFromUrl();
  if (roomId === undefined) return <FullScreenMessage title="Loading…" />;
  if (roomId === null)
    return (
      <FullScreenMessage
        title="That isn't a room link"
        body="Room codes have 8 characters, like ABCD-2345."
        action={
          <Link href="/rooms" className="btn-secondary">
            Go to your rooms
          </Link>
        }
      />
    );
  return <AuthGate>{(user) => <RoomView key={roomId} roomId={roomId} user={user} />}</AuthGate>;
}

function RoomView({ roomId, user }: { roomId: string; user: User }) {
  const room = useRoom(roomId, user);
  const [media, setMedia] = useState<MediaLike | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const sync = useSync({
    media,
    roomId,
    uid: user.uid,
    state: room.state,
    presence: room.presence,
    durationSec: room.meta?.durationSec ?? 0,
    setBuffering: room.setBuffering,
  });

  useEffect(() => {
    if (room.meta) document.title = `${room.meta.title} · WatchParty`;
  }, [room.meta]);

  const back = (
    <Link href="/rooms" className="btn-secondary">
      Go to your rooms
    </Link>
  );
  if (room.status === "notFound")
    return <FullScreenMessage title="Room not found" body="This room code is wrong, or the host deleted the room." action={back} />;
  if (room.status === "error") return <FullScreenMessage title="Couldn't open this room" body={room.error ?? undefined} action={back} />;
  if (room.status === "joining" || !room.meta) return <FullScreenMessage title="Joining room…" />;

  const meta = room.meta;
  const source: PlayerSource =
    meta.source === "youtube" && meta.youtubeId ? { kind: "youtube", id: meta.youtubeId } : { kind: "hls", src: meta.hlsUrl };

  function copy(what: "code" | "link") {
    void navigator.clipboard.writeText(what === "code" ? roomId : inviteLink(roomId));
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-bg/70 px-2 py-2 backdrop-blur-md sm:gap-3 sm:px-4">
        <Link href="/rooms" className="btn-ghost size-9 shrink-0 p-0" aria-label="Back to rooms" title="Back to rooms">
          <ArrowLeftIcon size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{meta.title}</h1>
          {!room.connected ? (
            <p className="text-xs text-amber-300">Reconnecting…</p>
          ) : (
            <button onClick={() => copy("code")} className="font-mono text-xs font-semibold tracking-[0.14em] text-accent sm:hidden">
              {copied === "code" ? "Code copied" : formatRoomCode(roomId)}
            </button>
          )}
        </div>
        <button
          onClick={() => copy("code")}
          title="Copy room code"
          className="hidden shrink-0 items-center gap-2 rounded-xl border border-line-strong bg-surface-2 px-3 py-2 font-mono text-sm font-semibold tracking-[0.14em] text-accent transition hover:bg-surface-3 sm:flex"
        >
          {formatRoomCode(roomId)}
          {copied === "code" ? <CheckIcon size={14} className="text-emerald-300" /> : <CopyIcon size={14} className="text-faint" />}
        </button>
        <button onClick={() => copy("link")} className="btn-primary shrink-0 px-3.5 py-2">
          {copied === "link" ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
          <span className="hidden sm:inline">{copied === "link" ? "Copied" : "Invite"}</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="shrink-0 bg-black lg:flex lg:min-w-0 lg:flex-1 lg:items-center">
          <Player
            source={source}
            onMedia={setMedia}
            controlsEnabled={sync.unlocked}
            overlay={
              <>
                <SyncStatus
                  waitingFor={sync.waitingFor}
                  selfBuffering={sync.selfBuffering}
                  state={room.state}
                  presence={room.presence}
                  selfUid={user.uid}
                />
                {!sync.unlocked && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-sm">
                    <button
                      onClick={sync.unlock}
                      disabled={!media}
                      className="btn-primary rounded-full px-6 py-3 text-base disabled:opacity-60"
                    >
                      <PlayIcon size={16} /> Join &amp; sync
                    </button>
                    <p className="text-xs text-white/60">{media ? "Starts where everyone else is" : "Loading player…"}</p>
                  </div>
                )}
              </>
            }
          />
        </div>
        <aside className="flex min-h-0 flex-1 flex-col border-line bg-surface/40 lg:w-[380px] lg:flex-none lg:border-l">
          <Participants presence={room.presence} selfUid={user.uid} />
          <ChatPanel roomId={roomId} user={user} messages={room.messages} />
        </aside>
      </div>
    </div>
  );
}
