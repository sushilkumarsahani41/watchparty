"use client";

import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/Icons";
import { useGo } from "@/lib/nav";
import { authErrorMessage, resetPassword, signIn, signUp, useAuth } from "@/lib/useAuth";

type Mode = "login" | "signup" | "reset";

/** Only allow same-site relative redirects. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/rooms";
}

function LoginForm() {
  const auth = useAuth();
  const go = useGo();
  const next = safeNext(useSearchParams().get("next"));

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === "signedIn") go(next, { replace: true });
  }, [auth.status, next, go]);

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
        <div className="mb-8 flex flex-col items-center text-center">
          <Wordmark size={34} />
          <p className="mt-3 text-sm text-muted">Watch anything together, perfectly in sync.</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6 shadow-2xl shadow-black/40 sm:p-7">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-faint">
              {mode === "login"
                ? "Sign in to join your rooms."
                : mode === "signup"
                  ? "One account for the web, Android and the uploader."
                  : "We'll email you a link to set a new password."}
            </p>
          </div>

          {auth.status === "error" && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-danger">{auth.error}</p>}

          {mode === "signup" && (
            <Field label="Display name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
                maxLength={40}
                placeholder="What friends will see"
                className="field"
              />
            </Field>
          )}

          <Field label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="field" />
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
                className="field"
              />
            </Field>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          {notice && <p className="text-sm text-emerald-300">{notice}</p>}

          <button type="submit" disabled={busy || auth.status === "error"} className="btn-primary w-full">
            {busy ? "Please wait…" : cta}
          </button>

          <div className="flex justify-between pt-1 text-sm text-muted">
            {mode === "login" ? (
              <>
                <button type="button" onClick={() => switchMode("signup")} className="transition hover:text-fg">
                  Create account
                </button>
                <button type="button" onClick={() => switchMode("reset")} className="transition hover:text-fg">
                  Forgot password?
                </button>
              </>
            ) : (
              <button type="button" onClick={() => switchMode("login")} className="transition hover:text-fg">
                ← Back to log in
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
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
