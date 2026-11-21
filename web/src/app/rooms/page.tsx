"use client";

import { AuthGate } from "@/components/AuthGate";
import { displayNameOf, signOut } from "@/lib/useAuth";

export default function RoomsPage() {
  return (
    <AuthGate>
      {(user) => (
        <main className="mx-auto max-w-3xl px-4 py-8">
          <header className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight">
              Watch<span className="text-accent">Party</span>
            </h1>
            <div className="flex items-center gap-3 text-sm">
              <span className="truncate text-zinc-400">
                {displayNameOf(user)} · {user.email}
              </span>
              <button
                onClick={() => void signOut()}
                className="rounded-lg border border-white/10 px-3 py-1.5 hover:bg-white/5"
              >
                Sign out
              </button>
            </div>
          </header>

          <section className="mt-10 rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-400">
            <p className="font-medium text-zinc-200">Your rooms</p>
            <p className="mt-1 text-sm">Room list and join-by-link arrive in milestone 2.</p>
          </section>
        </main>
      )}
    </AuthGate>
  );
}
