# WatchParty: Plan & Progress

Base design: [`WATCHPARTY_SPEC.md`](WATCHPARTY_SPEC.md). This file records changes to it and tracks progress.

## Changes from the spec (decided 2026-11-22)
- **Main viewer is a native Android app** (Kotlin, Jetpack Compose, Media3/ExoPlayer, Firebase Android SDK)
  in `android/`. It uses the same RTDB data model and rules as the web app.
- **The web app stays.** It's the fallback for invite links, desktop viewers, and the test bed for sync.
  Android and web users can be in the same room.
- **Sync math is duplicated in Kotlin** (unavoidable across TS/Kotlin). To keep them identical, the test cases
  live once in `packages/shared/src/sync.vectors.json` and both vitest and the Android JUnit tests run them.
- **Uploader stays desktop-only** (Electron + FFmpeg), as in the spec.
- Firebase project: `watchparty-o222t`, RTDB in `asia-southeast1`.
- **Sync refinements** (in shared math + vectors):
  - While paused, drift > 0.3s seeks (invisible) instead of waiting for rate correction after resume.
  - When a participant recovers from buffering more than 1.5s behind, they write their position as the new
    shared state, so the room rewinds to them instead of everyone skipping the part they missed.
  - A stall must last 400ms before it counts as buffering, so tiny hiccups don't pause everyone.
  - Holding Space doesn't auto-repeat play/pause.
  - Writers apply their own write locally right away (optimistic state), so a reconcile between the write and
    its snapshot doesn't seek away and back.
- **Android sync engine has no echo guard:** user actions come only from the app's own controls and are written
  directly; programmatic corrections never write.
  - Rate correction stops as soon as drift crosses zero (prevents overshoot with the 5s heartbeat).
  - User seeks are written on `seeking` (target known immediately), not `seeked`; jumps < 1s are ignored
    as hls.js gap nudges.

## Milestones

### 1. Scaffold + auth (web) ✅
- [x] pnpm workspace, `packages/shared` (types, paths, sync math, 20 tests)
- [x] RTDB rules deployed to the live project
- [x] Email signup / login / reset, `AuthGate`, profile self-heal
- [x] Verified with two accounts against the live project

### 2. Rooms + chat (web) ✅
- [x] Room page: self-join into `roomMembers` + `userRooms` on open
- [x] "Create test room" button on /rooms (hardcoded public test HLS URL)
- [x] My-rooms list, join by link/code
- [x] `ChatPanel` (last 100 messages, 1000-char limit), `Participants` with presence + onDisconnect
- [x] Verified: two browsers join via link, chat both ways, presence updates, bad links show "Room not found"

### 3. Synced player (web) ✅
- [x] `VideoPlayer` (hls.js, native HLS fallback), custom controls, keyboard
- [x] `serverTime.ts`, `useSync` (local writes, remote apply, echo guard, drift heartbeat, late-join button)
- [x] Verified: play/pause/seek both ways within ~0.05s, no echo writes, late join (paused and playing) lands within 0.05s without writing

### 4. Buffering-aware sync + quality menu + SyncStatus (web) ✅
- [x] Presence buffering flag, gate on `effectivePlaying`, "X is buffering…"
- [x] `QualityMenu` (Auto + available heights, per viewer, switches at next segment)
- [x] Verified: B's stalled network pauses A with "Bob is buffering…" within ~1.5s; both resume 0.01s apart; B's seek into unbuffered video is kept

### 5. Android app ✅
- [x] 5a. Project scaffold (Gradle 9.9 wrapper, AGP 9.5, compileSdk 37.1, Compose, Firebase), login / signup / reset
- [x] 5b. Rooms list, join via invite link (`https://<webHost>/room/{id}` + `watchparty://room/{id}`), chat, participants, share sheet
- [x] 5c. Media3 player + Kotlin sync engine (port of `sync.ts`, shared test vectors), buffering gate,
       quality menu, landscape fullscreen, background = offline
- [x] Verified on the Pixel 9 Pro emulator (Android 17) against web in one room: play/pause/seek both ways,
      chat both ways, Android-on-GSM pauses web with "Droid is buffering…" and both resume; steady-state drift ≤ 0.02s;
      rotation keeps playback without writes.
- Note: the emulator's `goldfish` H.264 decoder sometimes shows garbled frames after quality switches.
  Not seen on web; confirm on a real phone.

### 6. Desktop uploader (Electron) ✅ (real R2 run pending your keys)
- [x] FFmpeg multi-rendition HLS with progress + cancel, encoder detection (libx264 / VideoToolbox / NVENC, test-encoded), no-audio sources, skip tiers above source
- [x] R2 parallel upload (6), segments → variants → master, retry ×5 with backoff, resume via HeadObject, room creation, invite link; settings screen with keychain-encrypted R2 keys
- [x] Verified end to end with a local S3 stand-in for R2 + Firebase emulators: 40s 1080p MP4 → 4 renditions →
      33 objects with correct types/cache headers → room → plays and syncs in two web browsers.
- [x] Real Cloudflare R2 run: bucket `watchparty`, public at `https://watchparty-media.greatshark.in`, CORS set;
      20s clip encoded, uploaded, served publicly, resumed, deleted.

### 7. Polish + release (in progress)
- [x] Error states: room not found, player errors, reconnecting banner, auth error messages, upload retry/discard
- [x] Reconnect: presence via onDisconnect + `.info/connected` (web + Android); Android background = offline
- [x] README: Firebase, R2, web, Android (release signing, App Links), desktop, local testing
- [x] Desktop packaging (electron-builder): mac dir build verified (315 MB app, 3 MB app code); dmg/exe targets configured
- [x] Android release build (R8, 2.9 MB) verified on the emulator: login, deep link, sync, no crashes
- [x] Web checked at phone width (no horizontal scroll)
- [x] Real R2 upload run
- [x] Release keystore (`android/watchparty-release.jks` + `keystore.properties`, both gitignored; back them up)
      and `web/public/.well-known/assetlinks.json` with its fingerprint
- [ ] Deploy web to Cloudflare at `watchparty.greatshark.in` (needs `wrangler login`)
- [ ] Add `watchparty.greatshark.in` to Firebase Auth authorized domains and the R2 CORS list
- [ ] Confirm Android video on a real phone (emulator decoder shows glitches)

### 8. Room codes, delete, YouTube parties, redesign (requested after milestone 7) ✅
Spec changes (asked for by you):
- **Room codes:** new rooms get an 8-character code (alphabet without 0/O/1/I) as their room id; invite links carry it
  (`/room/ABCD2345`). Join accepts the code in any case, with spaces/dashes, or a link. Old push-id rooms still work.
  Shared: `generateRoomCode`, `parseRoomInput`, `createRoomWithCode` (retries a taken code); Kotlin port
  (`RoomInput.kt`) runs the same `rooms.vectors.json`.
- **Delete:** host-only. Rules: the host may delete `rooms/{id}`, `roomMembers/{id}` and `chats/{id}` (deletes only);
  presence writes now require membership (a deleted room can't get presence written back). Shared
  `roomDeletionWrites`. Web + Android: delete in the room list; members inside see "Room not found".
  Uploader: "My uploads" tab lists hosted rooms + R2 video folders (with sizes, including folders no room points
  at) and deletes files then the room. Verified with rules enforced (non-host deletes refused).
- **YouTube parties:** `meta.source = "youtube"` + `youtubeId` (title via oEmbed). Web: `YouTubeMedia` makes the
  IFrame player look like a `<video>` so `useSync` is unchanged. Android: `SyncPlayer` interface; `SyncEngine`
  drives `ExoSyncPlayer` or `YouTubeSyncPlayer` (WebView + JS bridge). YouTube honours 0.95/1.05 (measured
  1.048/0.952), so the sync rules are unchanged. A paused YouTube player only counts as ready once ≥2s is loaded
  ahead (else the buffering gate loops). Verified web↔Android: start, pause, ±10s, play; drift ≤ ~0.05s.
- **Redesign:** one token set (web `globals.css`, uploader `styles.css`, Android `Theme.kt`); new player controls
  (thin seek bar, smaller buttons, Android double-tap ±10s; fixes the portrait overlap of −10s/play with the
  bottom bar); new rooms/room/login screens on web + Android; uploader topbar, tabs, done screen with the code.
- **Hosting:** web is a static export served by Cloudflare Workers static assets (`web/wrangler.jsonc`, custom
  domain `watchparty.greatshark.in`); `/room/*` is rewritten to the one room page (`public/_redirects`).
- Local testing: `pnpm emulators` now uses the real project id so the emulator applies our rules to the same
  database namespace the apps use (before, local tests silently ran without rules).
- Android emulator note: WebView crashes on this AVD with `-gpu host`/default (no GLES version); use
  `-gpu swiftshader_indirect`. Not an app issue.
