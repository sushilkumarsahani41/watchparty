"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { push, ref, serverTimestamp } from "firebase/database";
import type { User } from "firebase/auth";
import { CHAT_MAX_LENGTH, paths } from "@watchparty/shared";
import { firebase } from "@/lib/firebase";
import { displayNameOf } from "@/lib/useAuth";
import type { ChatEntry } from "@/lib/useRoom";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function ChatPanel({ roomId, user, messages }: { roomId: string; user: User; messages: ChatEntry[] }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Keep scrolled to the newest message unless the user scrolled up to read history.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    setError(null);
    stickToBottom.current = true;
    try {
      await push(ref(firebase().db, paths.chat(roomId)), {
        uid: user.uid,
        name: displayNameOf(user),
        text: body.slice(0, CHAT_MAX_LENGTH),
        ts: serverTimestamp(),
      });
    } catch {
      setText(body);
      setError("Message not sent. Check your connection and try again.");
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">No messages yet. Say hi 👋</p>}
        {messages.map((m) => {
          const mine = m.uid === user.uid;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div className="mb-0.5 flex gap-2 text-[11px] text-zinc-500">
                {!mine && <span className="font-medium text-zinc-400">{m.name}</span>}
                <span>{typeof m.ts === "number" ? timeFmt.format(m.ts) : ""}</span>
              </div>
              <p
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm ${
                  mine ? "rounded-br-sm bg-accent-strong text-white" : "rounded-bl-sm bg-white/[0.07] text-zinc-100"
                }`}
              >
                {m.text}
              </p>
            </div>
          );
        })}
      </div>
      {error && <p className="px-3 pb-1 text-xs text-red-300">{error}</p>}
      <form onSubmit={send} className="flex gap-2 border-t border-white/10 p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Message"
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-accent"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-white transition hover:bg-accent disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  );
}
