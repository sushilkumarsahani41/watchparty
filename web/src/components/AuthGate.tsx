"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/useAuth";

/** Renders children only for signed-in users; otherwise redirects to /login?next=<current path>. */
export function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (auth.status === "signedOut") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [auth.status, pathname, router]);

  if (auth.status === "error") return <FullScreenMessage title="Setup error" body={auth.error} />;
  if (auth.status !== "signedIn") return <FullScreenMessage title="Loading…" />;
  return <>{children(auth.user)}</>;
}

export function FullScreenMessage({ title, body }: { title: string; body?: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-lg font-medium text-zinc-200">{title}</p>
        {body && <p className="mt-2 text-sm text-zinc-400">{body}</p>}
      </div>
    </main>
  );
}
