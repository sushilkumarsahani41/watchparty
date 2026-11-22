import { app, safeStorage } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Everything the uploader needs. Firebase web config isn't secret; R2 keys are. */
export interface Settings {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseDatabaseUrl: string;
  firebaseProjectId: string;
  firebaseAppId: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  mediaBaseUrl: string;
  webBaseUrl: string;
}

const ENV_KEYS: Record<keyof Settings, string> = {
  firebaseApiKey: "FIREBASE_API_KEY",
  firebaseAuthDomain: "FIREBASE_AUTH_DOMAIN",
  firebaseDatabaseUrl: "FIREBASE_DATABASE_URL",
  firebaseProjectId: "FIREBASE_PROJECT_ID",
  firebaseAppId: "FIREBASE_APP_ID",
  r2AccountId: "R2_ACCOUNT_ID",
  r2AccessKeyId: "R2_ACCESS_KEY_ID",
  r2SecretAccessKey: "R2_SECRET_ACCESS_KEY",
  r2Bucket: "R2_BUCKET",
  mediaBaseUrl: "MEDIA_BASE_URL",
  webBaseUrl: "WEB_BASE_URL",
};

const SECRET_KEYS: ReadonlyArray<keyof Settings> = ["r2SecretAccessKey", "r2AccessKeyId"];

/** Minimal .env parser (KEY=value, # comments, optional quotes). */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Dev convenience: desktop/.env (never bundled). Packaged builds use the Settings screen. */
function envDefaults(): Partial<Settings> {
  const candidates = [path.join(app.getAppPath(), ".env"), path.join(process.cwd(), ".env")];
  const file = candidates.find((f) => existsSync(f));
  const env = { ...(file ? parseEnv(readFileSync(file, "utf8")) : {}), ...process.env };
  const out: Partial<Settings> = {};
  for (const [k, envKey] of Object.entries(ENV_KEYS) as Array<[keyof Settings, string]>) {
    const v = env[envKey];
    if (v) out[k] = v;
  }
  return out;
}

const file = () => path.join(app.getPath("userData"), "settings.json");

type Stored = Partial<Record<keyof Settings, string>> & { _enc?: Partial<Record<keyof Settings, string>> };

/** Load settings: stored values win over .env defaults; secrets decrypted via the OS keychain. */
export async function loadSettings(): Promise<Settings> {
  let stored: Stored = {};
  try {
    stored = JSON.parse(await readFile(file(), "utf8")) as Stored;
  } catch {
    // first run
  }
  const merged: Record<string, string> = { r2Bucket: "watchparty-media", ...envDefaults() };
  for (const k of Object.keys(ENV_KEYS) as Array<keyof Settings>) {
    const plain = stored[k];
    const enc = stored._enc?.[k];
    if (enc && safeStorage.isEncryptionAvailable()) merged[k] = safeStorage.decryptString(Buffer.from(enc, "base64"));
    else if (plain) merged[k] = plain;
  }
  return Object.fromEntries((Object.keys(ENV_KEYS) as Array<keyof Settings>).map((k) => [k, merged[k] ?? ""])) as unknown as Settings;
}

export async function saveSettings(next: Settings): Promise<void> {
  const out: Stored = { _enc: {} };
  for (const k of Object.keys(ENV_KEYS) as Array<keyof Settings>) {
    const v = next[k]?.trim() ?? "";
    if (SECRET_KEYS.includes(k) && safeStorage.isEncryptionAvailable()) out._enc![k] = safeStorage.encryptString(v).toString("base64");
    else out[k] = v;
  }
  await writeFile(file(), JSON.stringify(out, null, 2), { mode: 0o600 });
}

/** Which required settings are missing (for a friendly "finish setup" screen). */
export function missingSettings(s: Settings): Array<keyof Settings> {
  return (Object.keys(ENV_KEYS) as Array<keyof Settings>).filter((k) => !s[k]);
}
