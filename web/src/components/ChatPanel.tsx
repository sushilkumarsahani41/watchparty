"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { push, ref, serverTimestamp } from "firebase/database";
import type { User } from "firebase/auth";
import { CHAT_MAX_LENGTH, paths } from "@watchparty/shared";
import { firebase } from "@/lib/firebase";
import { displayNameOf } from "@/lib/useAuth";
import type { ChatEntry } from "@/lib/useRoom";
import { SendIcon } from "./Icons";

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
      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <p className="text-sm font-medium text-muted">No messages yet</p>
            <p className="mt-1 text-xs text-faint">Say hi to everyone watching 👋</p>
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.uid === user.uid;
          const grouped = i > 0 && messages[i - 1]?.uid === m.uid;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"} ${grouped ? "!mt-1" : ""}`}>
              {!grouped && (
                <div className="mb-1 flex gap-2 px-1 text-[11px] text-faint">
                  {!mine && <span className="font-semibold text-muted">{m.name}</span>}
                  <span>{typeof m.ts === "number" ? timeFmt.format(m.ts) : ""}</span>
                </div>
              )}
              <p
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                  mine ? "rounded-br-md bg-accent-strong text-white" : "rounded-bl-md border border-line bg-surface-2 text-fg"
                }`}
              >
                {m.text}
              </p>
            </div>
          );
        })}
      </div>
      {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}
      <form onSubmit={send} className="flex items-center gap-2 border-t border-line p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Send a message"
          aria-label="Chat message"
          className="field rounded-full px-4"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-strong text-white transition hover:bg-accent disabled:opacity-30"
        >
          <SendIcon size={17} />
        </button>
      </form>
    </section>
  );
}
