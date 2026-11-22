import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { formatRoomCode } from "@watchparty/shared";
import type { Account, Encoder, JobEvent, JobPhase, LibraryItem, PickedFile, Settings } from "../shared/api";

const api = window.watchparty;

const QUALITIES = [
  { name: "360p", height: 360, hint: "For slow connections" },
  { name: "480p", height: 480, hint: "" },
  { name: "720p", height: 720, hint: "" },
  { name: "1080p", height: 1080, hint: "" },
];

const ENCODER_LABELS: Record<Encoder, string> = {
  libx264: "Software (libx264): best quality, slower",
  h264_videotoolbox: "Apple VideoToolbox: hardware, fast",
  h264_nvenc: "NVIDIA NVENC: hardware, fast",
};

type Screen = "loading" | "settings" | "login" | "upload" | "library";

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

  const home: Screen = account ? "upload" : "login";

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <div className="logo">
            <PlayIcon size={13} />
          </div>
          <span>
            Watch<em>Party</em>
          </span>
          <small>Uploader</small>
        </div>
        <div className="spacer" />
        {account && (
          <div className="account" title={account.email}>
            <div className="avatar">{account.displayName.slice(0, 1).toUpperCase()}</div>
            {account.displayName}
          </div>
        )}
        {screen !== "settings" && screen !== "loading" && (
          <button className="ghost icon" title="Settings" aria-label="Settings" onClick={() => setScreen("settings")}>
            <GearIcon />
          </button>
        )}
        {account && (
          <button
            className="ghost"
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

      {account && (screen === "upload" || screen === "library") && (
        <nav className="tabs">
          <button className={screen === "upload" ? "active" : ""} onClick={() => setScreen("upload")}>
            Upload
          </button>
          <button className={screen === "library" ? "active" : ""} onClick={() => setScreen("library")}>
            My uploads
          </button>
        </nav>
      )}

      {screen === "settings" && settings && (
        <SettingsScreen
          initial={settings}
          missing={missing}
          onSaved={async () => {
            const r = await reloadSettings();
            if (!r.missing.length) setScreen(home);
          }}
          onCancel={missing.length ? undefined : () => setScreen(home)}
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
      {/* Kept mounted while on other screens so a running upload's progress isn't lost. */}
      {account && (
        <div hidden={screen !== "upload"}>
          <UploadScreen />
        </div>
      )}
      {screen === "library" && <LibraryScreen />}
    </div>
  );
}

// ---------------- Settings ----------------

const SETTINGS_FIELDS: Array<{ key: keyof Settings; label: string; secret?: boolean; group: string; placeholder?: string }> = [
  { key: "firebaseApiKey", label: "API key", group: "Firebase" },
  { key: "firebaseAuthDomain", label: "Auth domain", group: "Firebase", placeholder: "<project>.firebaseapp.com" },
  { key: "firebaseDatabaseUrl", label: "Database URL", group: "Firebase" },
  { key: "firebaseProjectId", label: "Project ID", group: "Firebase" },
  { key: "firebaseAppId", label: "App ID", group: "Firebase" },
  { key: "r2AccountId", label: "Account ID", group: "Cloudflare R2" },
  { key: "r2Bucket", label: "Bucket", group: "Cloudflare R2" },
  { key: "r2AccessKeyId", label: "Access key ID", group: "Cloudflare R2", secret: true },
  { key: "r2SecretAccessKey", label: "Secret access key", group: "Cloudflare R2", secret: true },
  { key: "mediaBaseUrl", label: "Public media URL", group: "Links", placeholder: "https://media.example.com" },
  { key: "webBaseUrl", label: "Web app URL (invite links)", group: "Links", placeholder: "https://watch.example.com" },
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
      <h1>Settings</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        R2 keys are encrypted with your system keychain and only ever sent to Cloudflare.
      </p>
      {groups.map((g) => (
        <div className="card" key={g}>
          <div className="card-head">
            <h2>{g}</h2>
          </div>
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
          <button type="button" className="ghost" onClick={props.onCancel}>
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
    <form className="card center-card" onSubmit={submit}>
      <h1>Welcome back</h1>
      <p className="sub" style={{ marginBottom: 20 }}>
        Sign in with your WatchParty account. New here? Create one in the web or Android app.
      </p>
      <label>
        <span>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </label>
      <label>
        <span>Password</span>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && (
        <p className="error" style={{ marginTop: -4 }}>
          {error}
        </p>
      )}
      <button className="primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={busy}>
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
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

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
    setCopied(null);
    setEvent({ phase: "transcode", progress: 0, message: "Starting…" });
    try {
      await api.job.start({ file: file.path, title, renditions: chosen.length ? chosen : ["360p"], encoder });
    } catch (e) {
      setEvent({ phase: "error", progress: 0, message: errorText(e) });
    }
  }

  function copy(what: "code" | "link", text: string) {
    void api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  if (done) {
    return (
      <div className="card done">
        <div className="badge">
          <CheckIcon size={24} />
        </div>
        <h1>Your room is ready</h1>
        <p className="sub">Friends join with the room code or the invite link, in the web or Android app.</p>
        <div className="code">{formatRoomCode(done.roomId)}</div>
        <button className="ghost" onClick={() => copy("code", done.roomId)}>
          <CopyIcon /> {copied === "code" ? "Copied" : "Copy code"}
        </button>
        <div className="invite">
          <code>{done.inviteLink}</code>
          <button className="primary" onClick={() => copy("link", done.inviteLink)}>
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 18, justifyContent: "center" }}>
          <button onClick={() => void api.open(done.inviteLink)}>
            <ExternalIcon /> Open room
          </button>
          <button
            className="ghost"
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
        <div className="card-head">
          <div className="step">1</div>
          <h2>Choose a video</h2>
        </div>
        <div className="drop" onClick={running ? undefined : () => void pick()} role="button" tabIndex={0}>
          <div className="thumb">
            <FilmIcon />
          </div>
          {file ? (
            <div style={{ minWidth: 0 }}>
              <div className="name">{file.name}</div>
              <div className="meta">
                {file.probe.width}×{file.probe.height} · {formatDuration(file.probe.durationSec)} · {formatBytes(file.sizeBytes)} ·{" "}
                {file.probe.hasAudio ? "with audio" : "no audio"}
              </div>
            </div>
          ) : (
            <div>
              <div className="name">Pick a video file</div>
              <div className="meta">MP4, MKV, MOV, WebM and more</div>
            </div>
          )}
        </div>
        {pickError && <p className="error">{pickError}</p>}
      </div>

      {file && (
        <div className="card">
          <div className="card-head">
            <div className="step">2</div>
            <h2>Options</h2>
          </div>
          <label>
            <span>Room title</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={running} />
          </label>
          <label>
            <span>Qualities · tiers above the source resolution are skipped</span>
          </label>
          <div className="chips" style={{ marginTop: -6, marginBottom: 16 }}>
            {QUALITIES.map((q) => {
              const ok = available(q.height);
              const on = ok && qualities.includes(q.name);
              return (
                <label key={q.name} className={`chip ${on ? "on" : ""} ${ok ? "" : "disabled"}`} title={ok ? q.hint : "Larger than the source"}>
                  <input
                    type="checkbox"
                    disabled={!ok || running}
                    checked={on}
                    onChange={(e) => setQualities(e.target.checked ? [...qualities, q.name] : qualities.filter((x) => x !== q.name))}
                  />
                  {on && <CheckIcon size={12} />}
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
                <UploadIcon /> Encode &amp; upload
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
      <div className="card-head">
        <div className="step">3</div>
        <h2>Progress</h2>
      </div>
      <div className="steps">
        {PHASES.map((p, i) => {
          const pct = i < current ? 1 : i === current ? event.progress : 0;
          return (
            <div key={p.phase} className={`pstep ${i > current ? "pending" : ""}`}>
              <div className="top">
                <span className="label">
                  {i < current && <CheckIcon size={13} className="tick" />}
                  {p.label}
                </span>
                <span className="meta">
                  {i === current && !failed ? (event.message ?? `${Math.round(pct * 100)}%`) : i < current ? "Done" : ""}
                  {i === current && !failed && event.message ? ` · ${Math.round(pct * 100)}%` : ""}
                </span>
              </div>
              <Bar value={pct} />
            </div>
          );
        })}
      </div>
      {failed && (
        <p className={event.phase === "error" ? "error" : "sub"} style={{ marginTop: 14 }}>
          {event.message}
        </p>
      )}
      <div className="row end" style={{ marginTop: 16 }}>
        {(["transcode", "upload", "room"].includes(event.phase) || (event.phase === "error" && event.canRetry)) && (
          <button className="ghost" onClick={() => void api.job.cancel()}>
            {event.phase === "error" ? "Discard" : "Cancel"}
          </button>
        )}
        {event.phase === "error" && event.canRetry && (
          <button className="primary" onClick={() => void api.job.retry()}>
            Retry upload
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- Library ----------------

function LibraryScreen() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.library.list());
    } catch (e) {
      setError(errorText(e));
      setItems((cur) => cur ?? []);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const keyOf = (i: LibraryItem) => i.roomId ?? i.videoId ?? "";

  async function remove(item: LibraryItem) {
    setDeleting(keyOf(item));
    setError(null);
    try {
      await api.library.delete({ roomId: item.roomId, videoId: item.videoId });
      setItems((cur) => cur?.filter((x) => keyOf(x) !== keyOf(item)) ?? null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  const totalBytes = items?.reduce((n, i) => n + i.bytes, 0) ?? 0;

  return (
    <>
      <div className="lib-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>My uploads</h1>
          <p className="sub">
            Rooms you host{items ? ` · ${formatBytes(totalBytes)} on R2` : ""}. Deleting removes the room for everyone, and its video
            files.
          </p>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={() => void load()} disabled={items === null}>
          <RefreshIcon /> Refresh
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {items === null ? (
        <div className="list empty">
          <div className="spin" style={{ margin: "0 auto" }} />
        </div>
      ) : items.length === 0 ? (
        <div className="list empty">Nothing here yet. Upload a video to create your first room.</div>
      ) : (
        <div className="list">
          {items.map((item) => {
            const k = keyOf(item);
            return (
              <div className="item" key={k} data-testid="library-item">
                <div className={`icon-box ${item.source === "youtube" ? "yt" : item.roomId ? "" : "orphan"}`}>
                  {item.source === "youtube" ? <YouTubeIcon /> : <FilmIcon />}
                </div>
                <div className="body">
                  <div className="title" title={item.title}>
                    {item.title}
                  </div>
                  <div className="meta">
                    {item.roomId && <span className="pill">{formatRoomCode(item.roomId)}</span>}
                    {item.createdAtMs > 0 && (
                      <span>{new Date(item.createdAtMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                    )}
                    {item.source === "youtube" ? (
                      <span>· YouTube</span>
                    ) : item.files > 0 ? (
                      <span>· {formatBytes(item.bytes)}</span>
                    ) : item.roomId ? (
                      <span>· no files on R2</span>
                    ) : null}
                    {!item.roomId && <span>· not linked to a room</span>}
                  </div>
                </div>
                {confirming === k ? (
                  <div className="confirm">
                    <span className="sub">
                      Delete{item.roomId ? " room" : ""}
                      {item.roomId && item.files ? " and" : ""}
                      {item.files ? " files" : ""}?
                    </span>
                    <button className="ghost" onClick={() => setConfirming(null)} disabled={deleting === k}>
                      Cancel
                    </button>
                    <button className="danger" onClick={() => void remove(item)} disabled={deleting === k}>
                      {deleting === k ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 4 }}>
                    {item.inviteLink && (
                      <button
                        className="ghost icon"
                        title="Copy invite link"
                        aria-label="Copy invite link"
                        onClick={() => {
                          void api.copy(item.inviteLink!);
                          setCopied(k);
                          setTimeout(() => setCopied(null), 1500);
                        }}
                      >
                        {copied === k ? <CheckIcon /> : <CopyIcon />}
                      </button>
                    )}
                    <button className="ghost icon danger" title="Delete" aria-label="Delete" onClick={() => setConfirming(k)}>
                      <TrashIcon />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------- Bits ----------------

function Bar({ value }: { value: number }): ReactNode {
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

function errorText(e: unknown) {
  // IPC errors arrive as "Error invoking remote method '…': Error: <message>".
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}

// Icons (24px grid, stroke = currentColor).
function Svg({ size = 16, className, children }: { size?: number; className?: string; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}
const PlayIcon = ({ size }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />
  </svg>
);
const CheckIcon = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
const CopyIcon = () => (
  <Svg>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);
const TrashIcon = () => (
  <Svg>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </Svg>
);
const FilmIcon = () => (
  <Svg size={20}>
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <path d="m10 9 5 3-5 3V9Z" />
  </Svg>
);
const YouTubeIcon = () => (
  <Svg size={20}>
    <path d="M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
    <path d="m10 15 5-3-5-3z" />
  </Svg>
);
const UploadIcon = () => (
  <Svg>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </Svg>
);
const RefreshIcon = () => (
  <Svg size={14}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M8 16H3v5" />
  </Svg>
);
const ExternalIcon = () => (
  <Svg size={14}>
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Svg>
);
const GearIcon = () => (
  <Svg size={17}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Svg>
);
