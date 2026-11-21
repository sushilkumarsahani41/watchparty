"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FullScreenMessage } from "@/components/AuthGate";
import { useAuth } from "@/lib/useAuth";

export default function Home() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "signedIn") router.replace("/rooms");
    else if (auth.status === "signedOut") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status === "error") return <FullScreenMessage title="Setup error" body={auth.error} />;
  return <FullScreenMessage title="Loading…" />;
}
