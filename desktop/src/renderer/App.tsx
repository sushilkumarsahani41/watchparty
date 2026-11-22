import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Account, Encoder, JobEvent, JobPhase, PickedFile, Settings } from "../shared/api";

const api = window.watchparty;

const QUALITIES = [
  { name: "360p", height: 360, hint: "slow connections" },
  { name: "480p", height: 480, hint: "" },
  { name: "720p", height: 720, hint: "" },
  { name: "1080p", height: 1080, hint: "" },
];

const ENCODER_LABELS: Record<Encoder, string> = {
  libx264: "Software (libx264): best quality, slower",
  h264_videotoolbox: "Apple VideoToolbox: hardware, fast",
  h264_nvenc: "NVIDIA NVENC: hardware, fast",
};

type Screen = "loading" | "settings" | "login" | "upload";

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [missing, setMissing] = useState<Array<keyof Settings>>([]);
  const [account, setAccount] = useState<Account | null>(null);

  const reloadSettings = async () => {
    const r = await api.settings.get();
    setSettings(r.settings);
    setMissing(r.missing);
    return r;
  };

  useEffect(() => {
    void reloadSettings().then((r) => setScreen(r.missing.length ? "settings" : "login"));
  }, []);

  return (
    <div className="app">
      <header>
        <div>
          <div className="wordmark">
            Watch<span>Party</span> <span style={{ color: "var(--muted)", fontWeight: 400 }}>Uploader</span>
          </div>
          {account && <div className="sub">Signed in as {account.displayName} · {account.email}</div>}
        </div>
        <div className="spacer" />
        {screen !== "settings" && screen !== "loading" && (
          <button onClick={() => setScreen("settings")}>Settings</button>
        )}
        {account && (
          <button
            onClick={() => {
              void api.auth.signOut();
              setAccount(null);
              setScreen("login");
            }}
          >
            Sign out
          </button>
        )}
      </header>

      {screen === "settings" && settings && (
        <SettingsScreen
          initial={settings}
          missing={missing}
          onSaved={async () => {
            const r = await reloadSettings();
            if (!r.missing.length) setScreen(account ? "upload" : "login");
          }}
          onCancel={missing.length ? undefined : () => setScreen(account ? "upload" : "login")}
        />
      )}
      {screen === "login" && (
        <LoginScreen
          onSignedIn={(a) => {
            setAccount(a);
            setScreen("upload");
          }}
        />
      )}
      {screen === "upload" && <UploadScreen />}
    </div>
  );
}

// ---------------- Settings ----------------

const SETTINGS_FIELDS: Array<{ key: keyof Settings; label: string; secret?: boolean; group: string; placeholder?: string }> = [
  { key: "firebaseApiKey", label: "API key", group: "Firebase (same project as the web app)" },
  { key: "firebaseAuthDomain", label: "Auth domain", group: "Firebase (same project as the web app)", placeholder: "<project>.firebaseapp.com" },
  { key: "firebaseDatabaseUrl", label: "Database URL", group: "Firebase (same project as the web app)" },
  { key: "firebaseProjectId", label: "Project ID", group: "Firebase (same project as the web app)" },
  { key: "firebaseAppId", label: "App ID", group: "Firebase (same project as the web app)" },
  { key: "r2AccountId", label: "Account ID", group: "Cloudflare R2" },
  { key: "r2AccessKeyId", label: "Access key ID", group: "Cloudflare R2", secret: true },
  { key: "r2SecretAccessKey", label: "Secret access key", group: "Cloudflare R2", secret: true },
  { key: "r2Bucket", label: "Bucket", group: "Cloudflare R2" },
  { key: "mediaBaseUrl", label: "Public media URL", group: "URLs", placeholder: "https://media.example.com" },
  { key: "webBaseUrl", label: "Web app URL (for invite links)", group: "URLs", placeholder: "https://watch.example.com" },
];

function SettingsScreen(props: {
  initial: Settings;
  missing: Array<keyof Settings>;
  onSaved: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [s, setS] = useState<Settings>(props.initial);
  const [saving, setSaving] = useState(false);
  const groups = [...new Set(SETTINGS_FIELDS.map((f) => f.group))];

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    await api.settings.save(s);
    setSaving(false);
    await props.onSaved();
  }

  return (
    <form onSubmit={save}>
      {props.missing.length > 0 && (
        <p className="sub" style={{ marginTop: 0 }}>
          Finish setup to start uploading. R2 keys are encrypted with your system keychain and never leave this computer
          except to talk to Cloudflare.
        </p>
      )}
      {groups.map((g) => (
        <div className="card" key={g}>
          <h2>{g}</h2>
          <div className="grid2">
            {SETTINGS_FIELDS.filter((f) => f.group === g).map((f) => (
              <label key={f.key}>
                <span>
                  {f.label}
                  {props.missing.includes(f.key) && <span className="error"> · required</span>}
                </span>
                <input
                  type={f.secret ? "password" : "text"}
                  value={s[f.key]}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setS({ ...s, [f.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="row end" style={{ marginTop: 16 }}>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        )}
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

// ---------------- Login ----------------

function LoginScreen({ onSignedIn }: { onSignedIn: (a: Account) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api.auth.signIn(email, password);
    setBusy(false);
    if (r.ok) onSignedIn(r.account);
    else setError(r.error);
  }

  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 380, margin: "40px auto 0" }}>
      <h2>Sign in</h2>
      <p className="sub" style={{ marginTop: -8 }}>Use your WatchParty account (create one in the web or Android app).</p>
      <label>
        <span>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </label>
      <label>
        <span>Password</span>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" style={{ width: "100%" }} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

// ---------------- Upload ----------------

const PHASES: Array<{ phase: JobPhase; label: string }> = [
  { phase: "transcode", label: "Encode" },
  { phase: "upload", label: "Upload" },
  { phase: "room", label: "Create room" },
];

function UploadScreen() {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [qualities, setQualities] = useState<string[]>(["360p", "480p", "720p", "1080p"]);
  const [encoder, setEncoder] = useState<Encoder>("libx264");
  const [event, setEvent] = useState<JobEvent | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => api.job.onEvent(setEvent), []);

  const running = event !== null && ["transcode", "upload", "room"].includes(event.phase);
  const done = event?.phase === "done" ? event.result : undefined;

  async function pick() {
    setPickError(null);
    const r = await api.pickFile();
    if (!r) return;
    if ("error" in r) {
      setPickError(r.error);
      return;
    }
    setFile(r);
    setTitle(r.name.replace(/\.[^.]+$/, "").replace(/[._]+/g, " "));
    setEvent(null);
  }

  const available = (h: number) => !file || h <= file.probe.height;
  const chosen = qualities.filter((q) => available(QUALITIES.find((x) => x.name === q)!.height));

  async function start() {
    if (!file) return;
    setCopied(false);
    setEvent({ phase: "transcode", progress: 0, message: "Starting…" });
    try {
      await api.job.start({ file: file.path, title, renditions: chosen.length ? chosen : ["360p"], encoder });
    } catch (e) {
      setEvent({ phase: "error", progress: 0, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (done) {
    return (
      <div className="card">
        <h2 className="ok">✓ Room ready</h2>
        <p className="sub" style={{ marginTop: -6 }}>Share this link. Friends open it in the web or Android app.</p>
        <div className="invite">
          <code>{done.inviteLink}</code>
          <button
            className="primary"
            onClick={() => {
              void api.copy(done.inviteLink);
              setCopied(true);
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={() => void api.open(done.inviteLink)}>Open in browser</button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              setFile(null);
              setEvent(null);
            }}
          >
            Upload another
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2>1. Choose a video</h2>
        <div className="file" onClick={running ? undefined : () => void pick()} role="button" tabIndex={0}>
          <span style={{ fontSize: 22 }}>🎬</span>
          {file ? (
            <div>
              <div className="name">{file.name}</div>
              <div className="meta">
                {file.probe.width}×{file.probe.height} · {formatDuration(file.probe.durationSec)} ·{" "}
                {(file.sizeBytes / 1e9).toFixed(2)} GB · {file.probe.hasAudio ? "audio" : "no audio"}
              </div>
            </div>
          ) : (
            <div className="sub">Click to pick an MP4, MKV, MOV…</div>
          )}
        </div>
        {pickError && <p className="error">{pickError}</p>}
      </div>

      {file && (
        <div className="card">
          <h2>2. Options</h2>
          <label>
            <span>Room title</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={running} />
          </label>
          <label>
            <span>Qualities (tiers above the source resolution are skipped)</span>
          </label>
          <div className="chips" style={{ marginTop: -6, marginBottom: 14 }}>
            {QUALITIES.map((q) => {
              const ok = available(q.height);
              return (
                <label key={q.name} className={`chip ${ok ? "" : "disabled"}`} title={ok ? q.hint : "Larger than the source"} style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    disabled={!ok || running}
                    checked={ok && qualities.includes(q.name)}
                    onChange={(e) => setQualities(e.target.checked ? [...qualities, q.name] : qualities.filter((x) => x !== q.name))}
                  />
                  {q.name}
                </label>
              );
            })}
          </div>
          <label>
            <span>Encoder</span>
            <select value={encoder} onChange={(e) => setEncoder(e.target.value as Encoder)} disabled={running}>
              {file.encoders.map((e) => (
                <option key={e} value={e}>
                  {ENCODER_LABELS[e]}
                </option>
              ))}
            </select>
          </label>
          {!running && (
            <div className="row end">
              <button className="primary" onClick={() => void start()} disabled={chosen.length === 0}>
                Encode &amp; upload
              </button>
            </div>
          )}
        </div>
      )}

      {event && <Progress event={event} />}
    </>
  );
}

function Progress({ event }: { event: JobEvent }) {
  const idx = PHASES.findIndex((p) => p.phase === event.phase);
  const failed = event.phase === "error" || event.phase === "cancelled";
  const [lastIdx, setLastIdx] = useState(0);
  useEffect(() => {
    if (idx >= 0) setLastIdx(idx);
  }, [idx]);
  const current = idx >= 0 ? idx : lastIdx;

  return (
    <div className="card">
      <h2>3. Progress</h2>
      <div className="steps">
        {PHASES.map((p, i) => {
          const pct = i < current ? 1 : i === current && !failed ? event.progress : i === current ? event.progress : 0;
          return (
            <div key={p.phase} className={`step ${i > current ? "pending" : ""}`}>
              <div className="top">
                <span className="label">{p.label}</span>
                <span className="meta">
                  {i === current && !failed ? event.message ?? `${Math.round(pct * 100)}%` : i < current ? "Done" : ""}
                  {i === current && !failed && event.message ? ` · ${Math.round(pct * 100)}%` : ""}
                </span>
              </div>
              <Bar value={pct} />
            </div>
          );
        })}
      </div>
      {failed && <p className={event.phase === "error" ? "error" : "sub"}>{event.message}</p>}
      <div className="row end" style={{ marginTop: 14 }}>
        {event.phase === "error" && event.canRetry && (
          <button className="primary" onClick={() => void api.job.retry()}>
            Retry upload
          </button>
        )}
        {(["transcode", "upload", "room"].includes(event.phase) || (event.phase === "error" && event.canRetry)) && (
          <button onClick={() => void api.job.cancel()}>{event.phase === "error" ? "Discard" : "Cancel"}</button>
        )}
      </div>
    </div>
  );
}

function Bar({ value }: { value: number }): ReactNode {
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
}
