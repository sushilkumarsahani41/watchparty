"use client";

import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authErrorMessage, resetPassword, signIn, signUp, useAuth } from "@/lib/useAuth";

type Mode = "login" | "signup" | "reset";

/** Only allow same-site relative redirects. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/rooms";
}

function LoginForm() {
  const auth = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === "signedIn") router.replace(next);
  }, [auth.status, next, router]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") await signIn(email, password);
      else if (mode === "signup") await signUp(email, password, name);
      else {
        await resetPassword(email);
        setNotice("If an account exists for that email, a reset link is on its way.");
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "login" ? "Welcome back" : mode === "signup" ? "Create an account" : "Reset password";
  const cta = mode === "login" ? "Log in" : mode === "signup" ? "Sign up" : "Send reset link";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight">
          Watch<span className="text-accent">Party</span>
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-400">Watch together, in sync.</p>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-xl"
        >
          <h2 className="text-lg font-medium">{title}</h2>

          {auth.status === "error" && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{auth.error}</p>
          )}

          {mode === "signup" && (
            <Field label="Display name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
                maxLength={40}
                placeholder="What friends will see"
                className={inputCls}
              />
            </Field>
          )}

          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={inputCls}
            />
          </Field>

          {mode !== "reset" && (
            <Field label="Password">
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className={inputCls}
              />
            </Field>
          )}

          {error && <p className="text-sm text-red-300">{error}</p>}
          {notice && <p className="text-sm text-emerald-300">{notice}</p>}

          <button
            type="submit"
            disabled={busy || auth.status === "error"}
            className="w-full rounded-lg bg-accent-strong px-4 py-2.5 font-medium text-white transition hover:bg-accent disabled:opacity-50"
          >
            {busy ? "Please wait…" : cta}
          </button>

          <div className="flex justify-between text-sm text-zinc-400">
            {mode === "login" ? (
              <>
                <button type="button" onClick={() => switchMode("signup")} className="hover:text-zinc-100">
                  Create account
                </button>
                <button type="button" onClick={() => switchMode("reset")} className="hover:text-zinc-100">
                  Forgot password?
                </button>
              </>
            ) : (
              <button type="button" onClick={() => switchMode("login")} className="hover:text-zinc-100">
                ← Back to log in
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-300">{label}</span>
      {children}
    </label>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary for static rendering.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
