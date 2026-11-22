"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import type { User } from "firebase/auth";
import { AuthGate, FullScreenMessage } from "@/components/AuthGate";
import { ChatPanel } from "@/components/ChatPanel";
import { Participants } from "@/components/Participants";
import { SyncStatus } from "@/components/SyncStatus";
import { VideoPlayer } from "@/components/VideoPlayer";
import { inviteLink } from "@/lib/rooms";
import { useRoom } from "@/lib/useRoom";
import { useSync } from "@/lib/useSync";

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  return <AuthGate>{(user) => <RoomView key={roomId} roomId={roomId} user={user} />}</AuthGate>;
}

function RoomView({ roomId, user }: { roomId: string; user: User }) {
  const room = useRoom(roomId, user);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sync = useSync({
    videoRef,
    roomId,
    uid: user.uid,
    state: room.state,
    presence: room.presence,
    durationSec: room.meta?.durationSec ?? 0,
    setBuffering: room.setBuffering,
    mounted: room.status === "ready" && room.meta !== null,
  });

  if (room.status === "notFound")
    return <FullScreenMessage title="Room not found" body="This invite link is wrong or the room was deleted." />;
  if (room.status === "error") return <FullScreenMessage title="Couldn't open this room" body={room.error ?? undefined} />;
  if (room.status === "joining" || !room.meta) return <FullScreenMessage title="Joining room…" />;

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteLink(roomId));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <Link href="/rooms" className="text-sm text-zinc-400 hover:text-zinc-100" aria-label="Back to rooms">
          ←
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-medium">{room.meta.title}</h1>
        {!room.connected && <span className="text-xs text-amber-300">Reconnecting…</span>}
        <button
          onClick={() => void copyInvite()}
          className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
        >
          {copied ? "Copied!" : "Copy invite link"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="shrink-0 bg-black lg:flex lg:min-w-0 lg:flex-1 lg:items-center">
          <VideoPlayer
            src={room.meta.hlsUrl}
            videoRef={videoRef}
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
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
                    <button
                      onClick={sync.unlock}
                      className="rounded-full bg-accent-strong px-6 py-3 font-medium text-white shadow-xl transition hover:bg-accent"
                    >
                      ▶ Join &amp; sync
                    </button>
                  </div>
                )}
              </>
            }
          />
        </div>
        <aside className="flex min-h-0 flex-1 flex-col border-white/10 lg:w-96 lg:flex-none lg:border-l">
          <Participants presence={room.presence} selfUid={user.uid} />
          <ChatPanel roomId={roomId} user={user} messages={room.messages} />
        </aside>
      </div>
    </div>
  );
}
