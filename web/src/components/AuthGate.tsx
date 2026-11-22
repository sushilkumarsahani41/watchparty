"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/useAuth";

/** Renders children only for signed-in users; otherwise redirects to /login?next=<current path>. */
export function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "signedOut") {
      // window.location, not usePathname: /room/<code> is served by the static /room page.
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [auth.status, router]);

  if (auth.status === "error") return <FullScreenMessage title="Setup error" body={auth.error} />;
  if (auth.status !== "signedIn") return <FullScreenMessage title="Loading…" />;
  return <>{children(auth.user)}</>;
}

export function FullScreenMessage({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  const loading = title.endsWith("…");
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center text-center">
        {loading && <span className="mb-4 size-6 animate-spin rounded-full border-2 border-white/15 border-t-accent" />}
        <p className={`font-medium ${loading ? "text-sm text-muted" : "text-lg text-fg"}`}>{title}</p>
        {body && <p className="mt-2 text-sm text-muted">{body}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </main>
  );
}
