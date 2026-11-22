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

### 4. Buffering-aware sync + quality menu + SyncStatus (web)
- [ ] Presence buffering flag, gate on `effectivePlaying`, "X is buffering…"
- [ ] `QualityMenu` (Auto / 360p–1080p, per viewer)
- *Done when:* a throttled B pauses A and both resume together.

### 5. Android app
- [ ] 5a. Project scaffold (Gradle wrapper, Compose, Firebase), login / signup / reset
- [ ] 5b. Rooms list, join via invite link (App Links on `/room/{id}`), chat, participants
- [ ] 5c. Media3 player + Kotlin sync engine (port of `sync.ts`, shared test vectors), buffering gate,
       quality menu, landscape fullscreen
- *Done when:* Android and web in the same room stay in sync both ways.

### 6. Desktop uploader (Electron)
- [ ] FFmpeg multi-rendition HLS with progress + cancel, encoder detection
- [ ] R2 parallel upload with retry/resume, room creation, invite link
- *Done when:* a local MP4 becomes a playable room on Android and web.

### 7. Polish + release
- [ ] Error states, reconnect handling, README (Firebase, R2, Android setup)
- [ ] Deploy web (Vercel or Cloudflare Pages), signed release APK, Electron builds (dmg, exe)

## Needs from you (when we get there)
- Cloudflare R2 bucket + API keys (milestone 6)
- Web domain for invite links / App Links (milestone 5b/7)
- Android release signing key (milestone 7)
