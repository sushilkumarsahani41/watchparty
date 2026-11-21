# WatchParty

Personal watch-together app: synced HLS playback (anyone can play/pause/seek) plus chat.
Videos are transcoded locally and stored on Cloudflare R2. Firebase (free Spark plan) handles auth,
realtime sync and chat. See [`WATCHPARTY_SPEC.md`](WATCHPARTY_SPEC.md) for the full design.

| Path | What |
|---|---|
| `packages/shared` | Types, RTDB path builders, sync math (+ vitest tests) |
| `web` | Next.js app (login, rooms, player, chat) |
| `firebase` | Realtime Database rules + config |
| `desktop` | Electron uploader (milestone 5) |

## Requirements
- Node 20+ and pnpm (`corepack enable`)
- Firebase CLI (`npm i -g firebase-tools`); Java is needed only for the local emulators

## Quick start (local emulators, no Firebase project needed)
```sh
pnpm install
pnpm emulators            # auth :9099, database :9000, UI :4000
cp web/.env.local.example web/.env.local
```
Fill `web/.env.local` with demo values:
```
NEXT_PUBLIC_FIREBASE_API_KEY=demo-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-watchparty.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=http://127.0.0.1:9000?ns=demo-watchparty
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-watchparty
NEXT_PUBLIC_FIREBASE_APP_ID=demo-app
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
```
Then `pnpm dev` and open http://localhost:3000.

## Firebase setup (real project)
1. Create a project in the [Firebase console](https://console.firebase.google.com) (Spark plan is fine).
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Realtime Database:** create a database (pick the region closest to you), start in locked mode.
4. **Project settings → Your apps:** add a Web app and copy its config into `web/.env.local`
   (leave `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` empty).
5. Deploy the rules, either way works:
   - **Console (no CLI needed):** Realtime Database → **Rules** tab → paste the contents of
     `firebase/database.rules.json` → **Publish**. Repeat whenever that file changes.
   - **CLI:** set your project id in `firebase/.firebaserc`, then
     ```sh
     firebase login --reauth     # if you see 401 / "invalid authentication credentials"
     cd firebase && firebase deploy --only database
     ```
6. **Authentication → Settings → Authorized domains:** add your web domain when you deploy.

## Scripts
| Command | What |
|---|---|
| `pnpm dev` | Run the web app |
| `pnpm emulators` | Run Firebase Auth + RTDB emulators |
| `pnpm -r typecheck` | Typecheck all packages |
| `pnpm -r test` | Run unit tests |

Cloudflare R2 setup and the desktop uploader are documented in milestones 5–6.
