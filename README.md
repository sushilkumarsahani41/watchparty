# WatchParty

Personal watch-together app. Everyone in a room sees the same moment of the video; anyone can play, pause or
seek, and there's a chat. Videos are transcoded on your own computer and stored on Cloudflare R2. Firebase
(free Spark plan) handles accounts, realtime sync and chat. There is no backend server.

| Part | Path | What it is |
|---|---|---|
| Android app | `android/` | Main viewer: Kotlin, Jetpack Compose, Media3 (ExoPlayer), Firebase |
| Web app | `web/` | Same features in the browser (Next.js, hls.js). Invite-link fallback |
| Desktop uploader | `desktop/` | Electron: pick a video → FFmpeg HLS → upload to R2 → create room → invite link |
| Shared | `packages/shared/` | Data types, database paths, sync math + test vectors used by all apps |
| Firebase | `firebase/` | Realtime Database security rules |

Design: [`WATCHPARTY_SPEC.md`](WATCHPARTY_SPEC.md). Changes since then and progress: [`PLAN.md`](PLAN.md).

## How sync works (short version)
The room stores one shared playback state: `playing`, `position`, and the server time it was written.
Every player computes where the video *should* be (`position + elapsed`) and corrects itself: a jump if it's more
than 1.5s off, a gentle 0.95×/1.05× speed change if it's slightly off. If anyone is buffering, everyone pauses
locally ("Bob is buffering…") and resumes together. Details: `packages/shared/src/sync.ts`.

---

## 1. Firebase (once)
The project `watchparty-o222t` already exists. For a fresh project:
1. [Firebase console](https://console.firebase.google.com) → create a project (Spark plan).
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Realtime Database → Create database** (Singapore `asia-southeast1` is closest to India), locked mode.
4. Deploy the rules (either way):
   - Console: Realtime Database → **Rules** → paste `firebase/database.rules.json` → **Publish**.
   - CLI: put the project id in `firebase/.firebaserc`, then `firebase login --reauth` if needed and
     `cd firebase && firebase deploy --only database`.

## 2. Cloudflare R2 (once)
1. Cloudflare dashboard → **R2** → create bucket `watchparty-media` (location hint: Asia-Pacific).
2. Make it publicly readable: **Settings → Custom Domains** → connect e.g. `media.example.com`
   (or enable the `r2.dev` public URL for testing). This is your **media base URL**.
3. **R2 → Manage API tokens → Create API token**: *Object Read & Write*, limited to this bucket. Copy the
   Access Key ID, Secret Access Key, and your Account ID.
4. Bucket **Settings → CORS policy**:
   ```json
   [{
     "AllowedOrigins": ["https://<your-web-domain>", "http://localhost:3000"],
     "AllowedMethods": ["GET", "HEAD"],
     "AllowedHeaders": ["*"],
     "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
     "MaxAgeSeconds": 86400
   }]
   ```
   (The Android app doesn't need CORS.)
5. Optional: **Object lifecycle rule** to delete `videos/` objects older than N days.

Videos live at `videos/<random-uuid>/…`. The UUID makes the URL unguessable; it isn't access control.

## 3. Web app
```sh
pnpm install
cp web/.env.local.example web/.env.local   # fill in Firebase web config (+ media base URL)
pnpm dev                                   # http://localhost:3000
```
Firebase web config: Project settings → Your apps → Web app → config.

**Deploy (Cloudflare):** the web app is a static site. `cd web && pnpm exec wrangler login` once, then
`pnpm run deploy` builds it (with the `NEXT_PUBLIC_*` values in `web/.env.local`) and publishes it to
`https://watchparty.greatshark.in` (`web/wrangler.jsonc`). Room links `/room/<code>` are served by the one room
page via `web/public/_redirects`. The domain must also be in Firebase **Authentication → Settings → Authorized
domains** and in the R2 CORS list.

## 4. Android app
Requirements: Android Studio (or the SDK command-line tools) with **SDK Platform 37.1**, JDK 17+.

```sh
cd android
firebase apps:sdkconfig ANDROID <android-app-id> --project <project> -o app/google-services.json
./gradlew :app:assembleDebug               # app/build/outputs/apk/debug/app-debug.apk
```
`google-services.json` is gitignored. The Android app is registered as `dev.watchparty.app`.

Settings in `android/gradle.properties`:
- `watchparty.webHost` — your web domain. Used for invite links and to open `https://<host>/room/<id>` links
  directly in the app.
- `watchparty.useEmulators` — `true` to use local Firebase emulators (via `10.0.2.2`).

**Release build:** create a keystore and `android/keystore.properties` (gitignored):
```properties
storeFile=../watchparty-release.jks
storePassword=…
keyAlias=watchparty
keyPassword=…
```
then `./gradlew :app:assembleRelease` (R8-minified, ~3 MB). Without `keystore.properties` the release APK is
signed with the debug key: fine for sideloading to friends, not for the Play Store.

**Open invite links straight in the app (App Links):** host
`https://<webHost>/.well-known/assetlinks.json` (put it in `web/public/.well-known/`):
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "dev.watchparty.app",
    "sha256_cert_fingerprints": ["<SHA-256 of your signing cert>"]
  }
}]
```
Get the fingerprint with `keytool -list -v -keystore watchparty-release.jks`. Without this, Android asks which
app to open the link with. `watchparty://room/<id>` links always open the app.

## 5. Desktop uploader
```sh
cd desktop
cp .env.example .env      # optional: dev defaults; the app's Settings screen can set everything
pnpm dev                  # run from source
pnpm dist:mac             # dmg (build on a Mac)
pnpm dist:win             # NSIS installer (build on Windows: ffmpeg-static ships a per-OS binary)
```
Flow: sign in (same account as the apps) → pick a video → title, qualities (360p–1080p; tiers above the source
are skipped), encoder (libx264, or Apple VideoToolbox / NVIDIA NVENC when available) → **Encode & upload** →
copy the invite link. Upload order is segments → quality playlists → `master.m3u8`, with 5 retries per file;
a failed upload can be retried without re-encoding and skips files already on R2.

R2 keys are stored encrypted with the OS keychain (`safeStorage`) in the app's settings file, never in the repo.

## 6. Local development and testing
```sh
pnpm emulators      # local Firebase Auth + RTDB emulators (needs Java); same project id as the apps so the
                    # rules in firebase/database.rules.json apply (nothing touches the live project)
pnpm -r typecheck   # all TS packages
pnpm -r test        # shared sync tests (+ vectors), desktop ffmpeg/upload tests
cd android && ./gradlew :app:testDebugUnitTest   # Kotlin sync math against the same vectors
```
Web against emulators: set `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` in `web/.env.local`.
Desktop dev-only overrides: `WATCHPARTY_USE_EMULATORS=true`, `R2_ENDPOINT=<S3-compatible URL>`,
`WATCHPARTY_PICK_FILE=<path>` (skips the file dialog).

> Running Electron from VS Code's terminal: unset `ELECTRON_RUN_AS_NODE` first, or Electron starts as plain Node.
