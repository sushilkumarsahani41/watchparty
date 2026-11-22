"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Hls from "hls.js";
import { formatTime } from "@/lib/format";
import { YouTubeMedia, youTubeErrorMessage, type MediaLike } from "@/lib/media";
import { Back10Icon, ExpandIcon, Fwd10Icon, MuteIcon, PauseIcon, PlayIcon, ShrinkIcon, VolumeIcon } from "./Icons";
import { QualityMenu, type QualityLevel } from "./QualityMenu";

const SEEK_STEP_SEC = 10;
const HIDE_CONTROLS_MS = 2500;

export type PlayerSource = { kind: "hls"; src: string } | { kind: "youtube"; id: string };

/**
 * One player for uploaded (HLS) and YouTube videos, with our own controls. Controls only act on the
 * media (a <video> or YouTubeMedia); the sync engine turns the resulting media events into shared state.
 */
export function Player({
  source,
  onMedia,
  controlsEnabled,
  overlay,
}: {
  source: PlayerSource;
  /** Called with the media once it exists (and null when it goes away). */
  onMedia: (m: MediaLike | null) => void;
  controlsEnabled: boolean;
  overlay?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [media, setMedia] = useState<MediaLike | null>(null);

  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(-1);
  const [activeHeight, setActiveHeight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const publish = useCallback(
    (m: MediaLike | null) => {
      setMedia(m);
      onMedia(m);
    },
    [onMedia],
  );

  // --- Source: <video> + hls.js ---
  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video || source.kind !== "hls") return;
      setError(null);
      publish(video);
      if (Hls.isSupported()) {
        const hls = new Hls({ capLevelToPlayerSize: true, enableWorker: true });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLevels(hls.levels.map((l, index) => ({ index, height: l.height, bitrate: l.bitrate })));
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setActiveHeight(hls.levels[data.level]?.height ?? null));
        let mediaRecoveries = 0;
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 3) hls.recoverMediaError();
          else {
            setError("This video can't be played.");
            hls.destroy();
          }
        });
        hls.attachMedia(video);
        hls.loadSource(source.src);
        if (process.env.NODE_ENV !== "production") {
          // Test hook: lets browser tests simulate a stalled network (stopLoad / startLoad).
          (window as unknown as { __hls?: Hls }).__hls = hls;
        }
        return () => {
          hls.destroy();
          hlsRef.current = null;
          publish(null);
        };
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS native HLS (no manual quality selection).
        video.src = source.src;
        return () => {
          video.removeAttribute("src");
          video.load();
          publish(null);
        };
      }
      setError("This browser can't play this video.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source.kind === "hls" ? source.src : "", publish],
  );

  // --- Source: YouTube ---
  const youtubeId = source.kind === "youtube" ? source.id : null;
  useEffect(() => {
    const host = ytHostRef.current;
    if (!youtubeId || !host) return;
    setError(null);
    const yt = new YouTubeMedia(host, youtubeId);
    const onError = (e: Event) => setError(youTubeErrorMessage((e as CustomEvent<number>).detail));
    yt.addEventListener("error", onError);
    publish(yt);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __media?: MediaLike }).__media = yt; // test hook
    return () => {
      yt.removeEventListener("error", onError);
      yt.destroy();
      host.replaceChildren();
      publish(null);
    };
  }, [youtubeId, publish]);

  // --- Mirror media state into React ---
  useEffect(() => {
    if (!media) return;
    const sync = () => {
      setPaused(media.paused);
      setTime(media.currentTime);
      setDuration(Number.isFinite(media.duration) ? media.duration : 0);
      setVolume(media.volume);
      setMuted(media.muted);
      const b = media.buffered;
      setBufferedEnd(b.length ? b.end(b.length - 1) : 0);
    };
    const events = ["play", "pause", "timeupdate", "durationchange", "volumechange", "progress", "seeking", "seeked", "loadedmetadata"];
    events.forEach((e) => media.addEventListener(e, sync));
    sync();
    return () => events.forEach((e) => media.removeEventListener(e, sync));
  }, [media]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // --- Actions (all synced via media events) ---
  const togglePlay = useCallback(() => {
    if (!media) return;
    if (media.paused) void media.play().catch(() => {});
    else media.pause();
  }, [media]);

  const seekTo = useCallback(
    (t: number) => {
      if (!media) return;
      const max = Number.isFinite(media.duration) ? media.duration : t;
      media.currentTime = Math.min(Math.max(0, t), max);
    },
    [media],
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    const v = (media instanceof HTMLVideoElement ? media : null) as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else v?.webkitEnterFullscreen?.(); // iOS Safari
  }, [media]);

  const selectLevel = (index: number) => {
    setSelectedLevel(index);
    const hls = hlsRef.current;
    // nextLevel switches at the next fragment, avoiding a buffer flush (which would read as buffering).
    if (hls) hls.nextLevel = index;
  };

  // Keyboard: space/k = play/pause, arrows = ±10s (synced actions), f = fullscreen, m = mute.
  useEffect(() => {
    if (!controlsEnabled || !media) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === " " && tag !== "BUTTON") || e.key === "k") {
        e.preventDefault();
        // Holding space auto-repeats; toggling on every repeat would spam shared state.
        if (!e.repeat) togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(media.currentTime - SEEK_STEP_SEC);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(media.currentTime + SEEK_STEP_SEC);
      } else if (e.key === "f") {
        toggleFullscreen();
      } else if (e.key === "m") {
        media.muted = !media.muted;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controlsEnabled, media, togglePlay, seekTo, toggleFullscreen]);

  // Auto-hide controls while playing.
  const poke = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), HIDE_CONTROLS_MS);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const controlsVisible = controlsEnabled && (showControls || paused || scrub !== null);

  const shownTime = scrub ?? time;
  const pct = (x: number) => (duration ? `${Math.min(100, (x / duration) * 100)}%` : "0%");
  const quiet = muted || volume === 0;

  return (
    <div
      ref={containerRef}
      className={`group/player relative aspect-video w-full overflow-hidden bg-black ${fullscreen ? "h-full" : ""} ${controlsVisible ? "" : "cursor-none"}`}
      onPointerMove={poke}
      onPointerDown={poke}
    >
      {source.kind === "hls" ? (
        <video
          ref={videoRef}
          className="h-full w-full"
          playsInline
          preload="auto"
          onClick={controlsEnabled ? togglePlay : undefined}
          onDoubleClick={controlsEnabled ? toggleFullscreen : undefined}
        />
      ) : (
        <>
          <div ref={ytHostRef} className="absolute inset-0 [&>*]:h-full [&>*]:w-full" />
          {/* Clicks go to our controls, never straight into the YouTube frame (they'd bypass sync). */}
          <div
            className="absolute inset-0"
            onClick={controlsEnabled ? togglePlay : undefined}
            onDoubleClick={controlsEnabled ? toggleFullscreen : undefined}
          />
        </>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 p-6 text-center text-sm text-danger">{error}</div>
      )}

      {overlay}

      {/* Big center button while paused. */}
      {controlsEnabled && paused && !error && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute left-1/2 top-1/2 z-10 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white shadow-2xl backdrop-blur-md transition hover:scale-105 hover:bg-black/60"
        >
          <PlayIcon size={26} className="ml-1" />
        </button>
      )}

      {controlsEnabled && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2 pt-10 transition-opacity duration-200 sm:px-4 ${
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {/* Seek bar: preview while dragging, write only on release. */}
          <div
            className="group/seek relative h-5 cursor-pointer"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
              setHover({ x, t: duration ? (x / r.width) * duration : 0 });
            }}
            onPointerLeave={() => setHover(null)}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: pct(bufferedEnd) }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct(shownTime) }} />
              <div
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white shadow transition group-hover/seek:scale-100"
                style={{ left: pct(shownTime) }}
              />
            </div>
            {hover && duration > 0 && (
              <div
                className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white"
                style={{ left: hover.x }}
              >
                {formatTime(hover.t)}
              </div>
            )}
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={shownTime}
              tabIndex={-1}
              aria-label="Seek"
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => {
                if (scrub !== null) seekTo(scrub);
                setScrub(null);
              }}
              onPointerCancel={() => setScrub(null)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          <div className="mt-0.5 flex items-center gap-0.5 text-white sm:gap-1">
            <CtrlButton label={paused ? "Play (k)" : "Pause (k)"} onClick={togglePlay}>
              {paused ? <PlayIcon size={19} /> : <PauseIcon size={19} />}
            </CtrlButton>
            <CtrlButton label="Back 10 seconds (←)" onClick={() => seekTo(time - SEEK_STEP_SEC)}>
              <Back10Icon size={19} />
            </CtrlButton>
            <CtrlButton label="Forward 10 seconds (→)" onClick={() => seekTo(time + SEEK_STEP_SEC)}>
              <Fwd10Icon size={19} />
            </CtrlButton>
            <div className="group/vol flex items-center">
              <CtrlButton
                label={quiet ? "Unmute (m)" : "Mute (m)"}
                onClick={() => {
                  if (media) media.muted = !media.muted;
                }}
              >
                {quiet ? <MuteIcon size={19} /> : <VolumeIcon size={19} />}
              </CtrlButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                aria-label="Volume"
                onChange={(e) => {
                  if (!media) return;
                  media.volume = Number(e.target.value);
                  media.muted = media.volume === 0;
                }}
                className="hidden h-1 w-0 cursor-pointer accent-white opacity-0 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 sm:block"
              />
            </div>
            <span className="ml-1.5 text-xs font-medium tabular-nums text-white/85">
              {formatTime(shownTime)} <span className="text-white/45">/ {formatTime(duration)}</span>
            </span>
            <div className="flex-1" />
            <QualityMenu levels={levels} selected={selectedLevel} activeHeight={activeHeight} onSelect={selectLevel} />
            <CtrlButton label={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"} onClick={toggleFullscreen}>
              {fullscreen ? <ShrinkIcon size={18} /> : <ExpandIcon size={18} />}
            </CtrlButton>
          </div>
        </div>
      )}
    </div>
  );
}

function CtrlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label.replace(/ \(.+\)$/, "")}
      title={label}
      className="grid size-9 shrink-0 place-items-center rounded-lg text-white/90 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}
