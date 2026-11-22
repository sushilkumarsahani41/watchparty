"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Hls from "hls.js";
import { QualityMenu, type QualityLevel } from "./QualityMenu";

const SEEK_STEP_SEC = 10;
const HIDE_CONTROLS_MS = 2500;

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * hls.js player with custom controls. Controls only touch the <video> element; the sync
 * engine (useSync) turns the resulting media events into shared state.
 */
export function VideoPlayer({
  src,
  videoRef,
  controlsEnabled,
  overlay,
}: {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  controlsEnabled: boolean;
  overlay?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(-1);
  const [activeHeight, setActiveHeight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // --- Source / hls.js ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    if (Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true, enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(hls.levels.map((l, index) => ({ index, height: l.height, bitrate: l.bitrate })));
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setActiveHeight(hls.levels[data.level]?.height ?? null);
      });
      let mediaRecoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 3) {
          hls.recoverMediaError();
        } else {
          setError("This video can't be played.");
          hls.destroy();
        }
      });
      hls.attachMedia(video);
      hls.loadSource(src);
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / iOS native HLS (no manual quality selection).
      video.src = src;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    setError("This browser can't play HLS video.");
  }, [src, videoRef]);

  // --- Mirror media element state into React ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPaused(video.paused);
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setMuted(video.muted);
      const b = video.buffered;
      setBufferedEnd(b.length ? b.end(b.length - 1) : 0);
    };
    const events = ["play", "pause", "timeupdate", "durationchange", "volumechange", "progress", "seeked", "loadedmetadata"];
    events.forEach((e) => video.addEventListener(e, sync));
    sync();
    return () => events.forEach((e) => video.removeEventListener(e, sync));
  }, [videoRef]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // --- Actions (all synced via media events) ---
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, [videoRef]);

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      const max = Number.isFinite(v.duration) ? v.duration : t;
      v.currentTime = Math.min(Math.max(0, t), max);
    },
    [videoRef],
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else v?.webkitEnterFullscreen?.(); // iOS Safari
  }, [videoRef]);

  const selectLevel = (index: number) => {
    setSelectedLevel(index);
    const hls = hlsRef.current;
    // nextLevel switches at the next fragment, avoiding a buffer flush (which would read as buffering).
    if (hls) hls.nextLevel = index;
  };

  // Keyboard: space = play/pause, arrows = ±10s (synced actions).
  useEffect(() => {
    if (!controlsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const v = videoRef.current;
      if (!v) return;
      if (e.key === " " && tag !== "BUTTON") {
        e.preventDefault();
        // Holding space auto-repeats; toggling on every repeat would spam shared state.
        if (!e.repeat) togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(v.currentTime - SEEK_STEP_SEC);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(v.currentTime + SEEK_STEP_SEC);
      } else if (e.key === "f") {
        toggleFullscreen();
      } else if (e.key === "m") {
        v.muted = !v.muted;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controlsEnabled, videoRef, togglePlay, seekTo, toggleFullscreen]);

  // Auto-hide controls while playing.
  const poke = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), HIDE_CONTROLS_MS);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const controlsVisible = controlsEnabled && (showControls || paused || scrub !== null);

  const shownTime = scrub ?? time;
  const pct = (x: number) => (duration ? `${(x / duration) * 100}%` : "0%");

  return (
    <div
      ref={containerRef}
      className={`group relative aspect-video w-full bg-black ${fullscreen ? "h-full" : ""} ${controlsVisible ? "" : "cursor-none"}`}
      onPointerMove={poke}
      onPointerDown={poke}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        preload="auto"
        onClick={controlsEnabled ? togglePlay : undefined}
        onDoubleClick={controlsEnabled ? toggleFullscreen : undefined}
      />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-sm text-red-300">{error}</div>
      )}

      {overlay}

      {controlsEnabled && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {/* Seek bar: preview while dragging, write only on release. */}
          <div className="relative h-4">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: pct(bufferedEnd) }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct(shownTime) }} />
            </div>
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

          <div className="mt-1 flex items-center gap-1 text-zinc-100">
            <IconButton label={paused ? "Play" : "Pause"} onClick={togglePlay}>
              {paused ? "▶" : "❚❚"}
            </IconButton>
            <IconButton label="Back 10 seconds" onClick={() => seekTo(time - SEEK_STEP_SEC)}>
              ↺
            </IconButton>
            <IconButton label="Forward 10 seconds" onClick={() => seekTo(time + SEEK_STEP_SEC)}>
              ↻
            </IconButton>
            <span className="ml-1 text-xs tabular-nums text-zinc-300">
              {formatTime(shownTime)} / {formatTime(duration)}
            </span>
            <div className="flex-1" />
            <IconButton
              label={muted || volume === 0 ? "Unmute" : "Mute"}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.muted = !v.muted;
              }}
            >
              {muted || volume === 0 ? "🔇" : "🔊"}
            </IconButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => {
                const v = videoRef.current;
                if (!v) return;
                v.volume = Number(e.target.value);
                v.muted = v.volume === 0;
              }}
              className="hidden w-20 accent-[var(--color-accent)] sm:block"
            />
            <QualityMenu levels={levels} selected={selectedLevel} activeHeight={activeHeight} onSelect={selectLevel} />
            <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
              {fullscreen ? "⤡" : "⤢"}
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-md text-base hover:bg-white/10"
    >
      {children}
    </button>
  );
}
