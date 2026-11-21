# WatchParty conventions

Full spec: `WATCHPARTY_SPEC.md`. Ask before deviating from it.

- TypeScript strict. pnpm only. No `any` without a comment.
- Shared types/paths/sync math live in `packages/shared`; never duplicate them.
- Never commit secrets (`.env*`, service keys). Provide `.env.example` only.
- Pure sync logic (`sync.ts`) must have unit tests (vitest): expected position, drift decision, buffering gate.
- Keep the web app free of server code; all backend logic is Firebase rules + client SDK.
- Small commits per milestone; run `pnpm -r typecheck` and `pnpm -r test` before each.

## Layout
- `packages/shared` — `@watchparty/shared`, consumed as TS source (web uses `transpilePackages`).
- `web` — Next.js App Router, static client-only pages.
- `desktop` — Electron uploader (milestone 5).
- `firebase` — RTDB rules + config. Deploy with `firebase deploy --only database` from `firebase/`.
