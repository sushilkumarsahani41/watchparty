# WatchParty: Project Spec

Personal-use watch-together app. Synced video playback (play/pause/seek by anyone) + chat.
Video is HLS, transcoded locally on the uploader's PC/Mac, stored on Cloudflare R2.
Firebase (Spark/free plan, **no Cloud Storage**) handles auth, realtime sync and chat.

Build in milestones (see bottom). Ask before deviating from this spec.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Web app | Next.js (App Router) + TypeScript + Tailwind, hls.js |
| Desktop uploader | Electron + TypeScript, `ffmpeg-static`, `@aws-sdk/client-s3` |
| Auth | Firebase Auth, Email/Password |
| Realtime sync + chat + rooms | Firebase Realtime Database (RTDB) |
| Video storage/delivery | Cloudflare R2 (public bucket on custom domain, unguessable UUID folders) |
| Package manager | pnpm workspaces |

No backend server. No Firestore. No Firebase Storage. No Cloud Functions.

## 2. Repo layout

```
watchparty/
  package.json              # pnpm workspace root
  pnpm-workspace.yaml
  CONTRIBUTING.md                 # copy of conventions section below
  README.md
  .gitignore
  packages/
    shared/                 # TS types + helpers used by web and desktop
      src/
        types.ts            # RoomMeta, PlaybackState, Presence, ChatMessage
        paths.ts            # RTDB path builders
        sync.ts             # pure sync math (expectedPosition, drift decision)
      package.json
  firebase/
    database.rules.json
    firebase.json
    .firebaserc
  web/
    package.json
    next.config.ts
    .env.local.example
    src/
      app/
        layout.tsx
        page.tsx                    # redirect to /rooms or /login
        login/page.tsx              # email login + signup + reset
        rooms/page.tsx              # list my rooms, join by code
        room/[roomId]/page.tsx      # player + chat
      components/
        AuthGate.tsx
        VideoPlayer.tsx             # hls.js, exposes controls
        ChatPanel.tsx
        Participants.tsx
        QualityMenu.tsx
        SyncStatus.tsx              # "Friend is buffering…"
      lib/
        firebase.ts                 # init app, auth, rtdb
        useAuth.ts
        useRoom.ts                  # subscribes to meta/state/presence/chat
        useSync.ts                  # THE sync engine (section 5)
        serverTime.ts               # .info/serverTimeOffset helper
  desktop/
    package.json
    electron-builder.yml
    .env.example
    src/
      main/
        index.ts                    # window, IPC
        ffmpeg.ts                   # HLS transcode with progress
        r2Upload.ts                 # parallel upload with retry
        firebase.ts                 # sign in + create room in RTDB
      preload/index.ts
      renderer/
        index.html
        App.tsx                     # login, pick file, options, progress, share link
```

## 3. Firebase data model (RTDB)

```
users/{uid}: { email, displayName, createdAt }

rooms/{roomId}/meta: {
  title, hostUid, createdAt,
  videoId,                       # uuid, also the R2 folder name
  hlsUrl,                        # https://media.<domain>/videos/{videoId}/master.m3u8
  durationSec
}

rooms/{roomId}/state: {          # shared playback state, anyone in the room may write
  playing: boolean,
  position: number,              # seconds, video time at updatedAt
  updatedAt: ServerValue.TIMESTAMP,
  rate: 1,
  rev: number,                   # increment on every write
  by: uid
}

rooms/{roomId}/presence/{uid}: {
  online: boolean,               # set with onDisconnect()
  buffering: boolean,
  name: string,
  lastSeen: ServerValue.TIMESTAMP
}

roomMembers/{roomId}/{uid}: true # membership, single source of truth for rules
userRooms/{uid}/{roomId}: true   # for "my rooms" list

chats/{roomId}/{pushId}: { uid, name, text, ts: ServerValue.TIMESTAMP }
```

Invite link = `https://<web-domain>/room/{roomId}`. roomId is a push-id/UUID (unguessable).
Opening the link while logged in self-adds to `roomMembers` and `userRooms`.

## 4. Security rules (`firebase/database.rules.json`)

```json
{
  "rules": {
    "users": {
      "$uid": { ".read": "auth != null", ".write": "auth != null && auth.uid === $uid" }
    },
    "userRooms": {
      "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" }
    },
    "roomMembers": {
      "$roomId": {
        ".read": "auth != null && root.child('roomMembers').child($roomId).child(auth.uid).exists()",
        "$uid": { ".write": "auth != null && auth.uid === $uid" }
      }
    },
    "rooms": {
      "$roomId": {
        ".read": "auth != null && root.child('roomMembers').child($roomId).child(auth.uid).exists()",
        "meta": {
          ".write": "auth != null && (!data.exists() || data.child('hostUid').val() === auth.uid)"
        },
        "state": {
          ".write": "auth != null && root.child('roomMembers').child($roomId).child(auth.uid).exists()"
        },
        "presence": {
          "$uid": { ".write": "auth != null && auth.uid === $uid" }
        }
      }
    },
    "chats": {
      "$roomId": {
        ".read": "auth != null && root.child('roomMembers').child($roomId).child(auth.uid).exists()",
        "$msgId": {
          ".write": "auth != null && !data.exists() && root.child('roomMembers').child($roomId).child(auth.uid).exists()",
          ".validate": "newData.hasChildren(['uid','name','text','ts']) && newData.child('uid').val() === auth.uid && newData.child('text').isString() && newData.child('text').val().length <= 1000"
        }
      }
    }
  }
}
```

Known simplification: anyone with the roomId can self-join. Fine for personal use.
Add `.indexOn` for `chats/$roomId` -> `ts` if querying by it.

## 5. Sync engine (`web/src/lib/useSync.ts`, math in `packages/shared/src/sync.ts`)

Time: read `.info/serverTimeOffset`; `serverNow() = Date.now() + offset`.

**Local user actions** (play / pause / seek):
write `rooms/{id}/state` = `{ playing, position: video.currentTime, updatedAt: serverTimestamp, rev: prev+1, by: uid }`.
Use a transaction or just last-write-wins (acceptable).

**Applying remote state** (on every `state` snapshot, including own writes):
```
expected = state.playing ? state.position + (serverNow() - state.updatedAt)/1000 * state.rate
                         : state.position
drift = video.currentTime - expected
if |drift| > 1.5        -> seek to expected
else if |drift| > 0.3 and playing -> playbackRate = drift > 0 ? 0.95 : 1.05 (restore to 1 once < 0.1)
if state.playing != !video.paused -> play()/pause()
```
Wrap every programmatic `play/pause/seek` in an `applyingRemote` guard (set true, perform, clear on the
resulting media event or a short timeout) so those events are NOT written back (prevents echo loops).

**Late joiner:** read `state` once on mount, apply with the formula above. Show a "Click to join & sync"
button first (browser autoplay policy), then apply.

**Drift heartbeat:** every 5s re-run the apply logic against the latest cached state.

**Buffering-aware playback:**
- On `waiting` / `stalled` -> set own `presence.buffering = true`; on `canplay`/`playing` -> false.
- Effective playing = `state.playing && no online participant has buffering === true`.
- If someone is buffering: pause locally (do NOT write shared state), show "X is buffering…".
  When nobody is buffering, resume locally and re-align with the formula.
- Presence: set `online=true`, register `onDisconnect().update({ online:false, buffering:false })`.

**Seeking:** debounce slider scrubbing; write state only on release.

## 6. Player (`VideoPlayer.tsx`)

- hls.js with ABR on (`capLevelToPlayerSize: true`), native HLS fallback for Safari.
- Quality menu: Auto / 360p / 480p / 720p / 1080p (per-viewer only, not synced).
- Custom controls: play/pause, seek bar, time, volume, fullscreen. Every control is available to every member.
- Keyboard: space = play/pause, arrows = ±10s (these are synced actions).

## 7. Desktop uploader (Electron)

Flow: sign in (same Firebase email account) -> choose file -> options (title, qualities, preset) ->
transcode -> upload -> create room -> show invite link + copy button.

**FFmpeg (use `ffmpeg-static`, spawn from main process, parse `-progress pipe:1` for percent).**
Multi-rendition HLS, H.264 + AAC, 6s segments, master playlist. Template:
```
ffmpeg -i INPUT -preset veryfast \
  -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=-2:480[v1o];[v2]scale=-2:720[v2o];[v3]scale=-2:1080[v3o]" \
  -map "[v1o]" -c:v:0 libx264 -b:v:0 1000k -maxrate:v:0 1100k -bufsize:v:0 2000k \
  -map "[v2o]" -c:v:1 libx264 -b:v:1 2500k -maxrate:v:1 2750k -bufsize:v:1 5000k \
  -map "[v3o]" -c:v:2 libx264 -b:v:2 5000k -maxrate:v:2 5500k -bufsize:v:2 10000k \
  -map a:0 -map a:0 -map a:0 -c:a aac -b:a 128k -ac 2 \
  -g 144 -keyint_min 144 -sc_threshold 0 \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments \
  -hls_segment_filename "OUT/v%v/seg_%05d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" "OUT/v%v/index.m3u8"
```
Options: toggle which renditions to include (add a 360p ~600k tier for slow connections); skip renditions
larger than the source; choose encoder (libx264 default; detect `h264_videotoolbox` on macOS and
`h264_nvenc` on Windows/NVIDIA as optional faster encoders). Handle sources with no audio.
Support cancel (kill process, clean temp dir). Output to a temp dir; delete after upload.

**R2 upload (`@aws-sdk/client-s3`, endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`):**
- Key prefix: `videos/{uuid}/`.
- Upload segments in parallel (concurrency 6-8), **playlists last** (variant playlists, then `master.m3u8`).
- Content types: `.m3u8` -> `application/vnd.apple.mpegurl`, `.ts` -> `video/mp2t`.
- Cache-Control: segments `public, max-age=31536000, immutable`; playlists `public, max-age=60`.
- Retry with exponential backoff (5 tries). Overall progress bar. Resume = skip keys already present (HeadObject).
- Credentials come from local `.env`/electron-store (never committed, never bundled in the renderer).

**Create room:** after upload, write `rooms/{id}/meta`, `roomMembers/{id}/{hostUid}`, `userRooms/{hostUid}/{id}`,
initial `state { playing:false, position:0, rev:0 }` via Firebase JS SDK (signed in as the user).

## 8. Cloudflare R2 setup (manual, document in README)

1. Create bucket `watchparty-media` (location hint: Asia-Pacific).
2. Connect a custom domain (e.g. `media.example.com`) or enable the r2.dev public URL for testing.
3. Create an API token (Object Read & Write, scoped to the bucket). Put keys in `desktop/.env`.
4. CORS on the bucket:
```json
[{
  "AllowedOrigins": ["https://<web-domain>", "http://localhost:3000"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
  "MaxAgeSeconds": 86400
}]
```
5. Optional lifecycle rule: delete `videos/` objects older than N days.

## 9. Env vars

`web/.env.local.example`
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_MEDIA_BASE_URL=https://media.example.com
```
`desktop/.env.example`
```
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_DATABASE_URL=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=watchparty-media
MEDIA_BASE_URL=https://media.example.com
WEB_BASE_URL=https://watch.example.com
```

## 10. Milestones (each ends with something runnable; commit after each)

1. **Scaffold:** pnpm workspace, `packages/shared`, Next.js app, Firebase init, `database.rules.json`,
   email signup/login/reset, `AuthGate`. *Done when:* two accounts can log in.
2. **Rooms + chat:** create/join room by link (self-join into `roomMembers`), `ChatPanel`, `Participants` with presence.
   Use a hardcoded public test HLS URL in `meta.hlsUrl`. *Done when:* two browsers chat in one room.
3. **Synced player:** `VideoPlayer` + `useSync` (play/pause/seek sync, late join, drift correction, echo guard).
   *Done when:* pausing/seeking in browser A reflects in B within ~1s, in both directions, no loops.
4. **Buffering-aware sync + quality menu + SyncStatus.** *Done when:* throttling B's network (DevTools)
   pauses A with "B is buffering…" and both resume together.
5. **Desktop uploader:** Electron app, ffmpeg transcode w/ progress, R2 parallel upload, room creation, invite link.
   *Done when:* a local MP4 becomes a playable room in the web app.
6. **Polish:** error states, reconnect handling, README with Firebase + R2 setup, deploy web (Vercel or Cloudflare Pages),
   package Electron builds (mac dmg, win exe).

## 11. Conventions (put in CONTRIBUTING.md)

- TypeScript strict. pnpm only. No `any` without a comment.
- Shared types/paths/sync math live in `packages/shared`; never duplicate them.
- Never commit secrets (`.env*`, service keys). Provide `.env.example` only.
- Pure sync logic (`sync.ts`) must have unit tests (vitest): expected position, drift decision, buffering gate.
- Keep the web app free of server code; all backend logic is Firebase rules + client SDK.
- Small commits per milestone; run `pnpm -r typecheck` and `pnpm -r test` before each.
