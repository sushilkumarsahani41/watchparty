"use client";

/**
 * The part of HTMLMediaElement the player UI and the sync engine use. An HTMLVideoElement satisfies it
 * as is; YouTubeMedia implements it on top of the YouTube IFrame API, so sync works the same for both.
 */
export interface MediaLike extends EventTarget {
  currentTime: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly seeking: boolean;
  /** HTMLMediaElement.readyState values: 0 nothing, 1 metadata, 3 future data, 4 enough data. */
  readonly readyState: number;
  /** NaN while unknown. */
  readonly duration: number;
  readonly buffered: { readonly length: number; end(index: number): number };
  play(): Promise<void>;
  pause(): void;
}

export const HAVE_METADATA = 1;
export const HAVE_FUTURE_DATA = 3;

// --- YouTube IFrame API (just what we use; avoids a @types dependency) ---

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoLoadedFraction(): number;
  getVideoData(): { title?: string };
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Loaded video ahead of the playhead needed before a paused YouTube player counts as ready. */
const MIN_AHEAD_SEC = 2;

const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("Couldn't load the YouTube player. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Message for YouTube player error codes. */
export function youTubeErrorMessage(code: number): string {
  if (code === 101 || code === 150 || code === 152) return "The owner of this YouTube video doesn't allow playing it outside YouTube.";
  if (code === 100) return "This YouTube video was removed or is private.";
  if (code === 2) return "That isn't a valid YouTube video.";
  return `YouTube can't play this video (error ${code}).`;
}

/** A YouTube embed that behaves like a <video> element (see MediaLike). */
export class YouTubeMedia extends EventTarget implements MediaLike {
  private player: YTPlayer | null = null;
  private ytState: number = YT_STATE.UNSTARTED;
  private ready = false;
  private destroyed = false;
  private _paused = true;
  private _ended = false;
  private _seeking = false;
  private seekTarget = 0;
  private _rate = 1;
  private _volume = 1;
  private _muted = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Paused before enough video loaded: "canplay" is held back until it has (see readyState). */
  private dataWaitSince: number | null = null;

  constructor(container: HTMLElement, videoId: string) {
    super();
    const mount = document.createElement("div");
    container.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (this.destroyed) return;
        this.player = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => this.onReady(),
            onStateChange: (e) => this.onStateChange(e.data),
            onError: (e) => this.emit("error", e.data),
          },
        });
      })
      .catch(() => this.emit("error", -1));
  }

  private emit(type: string, detail?: number) {
    this.dispatchEvent(detail === undefined ? new Event(type) : new CustomEvent(type, { detail }));
  }

  private onReady() {
    this.ready = true;
    this.player?.setPlaybackRate(this._rate);
    this.emit("loadedmetadata");
    this.emit("durationchange");
    this.emit("canplay");
    this.timer = setInterval(() => this.tick(), 250);
  }

  private tick() {
    const p = this.player;
    if (!p) return;
    if (this._seeking && Math.abs(p.getCurrentTime() - this.seekTarget) < 1 && this.ytState !== YT_STATE.BUFFERING) {
      this.finishSeek();
    }
    if (this.ytState === YT_STATE.PLAYING) this.emit("timeupdate");
    this.emit("progress");
    if (this.dataWaitSince !== null && this.readyState >= HAVE_FUTURE_DATA) {
      this.dataWaitSince = null;
      this.emit("canplay");
    }
  }

  /** Seconds of video loaded beyond the current position. */
  private bufferedAhead(): number {
    const p = this.player;
    if (!p || !this.ready) return 0;
    return p.getVideoLoadedFraction() * (p.getDuration() || 0) - p.getCurrentTime();
  }

  private finishSeek() {
    if (!this._seeking) return;
    this._seeking = false;
    this.emit("seeked");
    this.emit("timeupdate");
  }

  private onStateChange(s: number) {
    this.ytState = s;
    switch (s) {
      case YT_STATE.BUFFERING:
        this.emit("waiting");
        break;
      case YT_STATE.PLAYING:
        this._ended = false;
        this.dataWaitSince = null;
        // Started by YouTube itself (not via play()): report it like a <video> would.
        if (this._paused) {
          this._paused = false;
          this.emit("play");
        }
        this.finishSeek();
        this.emit("playing");
        this.emit("durationchange");
        break;
      case YT_STATE.PAUSED:
        this.finishSeek();
        if (!this._paused) {
          this._paused = true;
          this.emit("pause");
        }
        // Paused while still loading (e.g. the room holds everyone while we buffer): only report ready once
        // enough is loaded, or the sync engine would resume us straight into the same stall, over and over.
        if (this.readyState >= HAVE_FUTURE_DATA) this.emit("canplay");
        else this.dataWaitSince = Date.now();
        break;
      case YT_STATE.ENDED:
        this.finishSeek();
        this._ended = true;
        if (!this._paused) {
          this._paused = true;
          this.emit("pause");
        }
        this.emit("ended");
        break;
      case YT_STATE.CUED:
        this.emit("canplay");
        break;
    }
  }

  get paused() {
    return this._paused;
  }
  get ended() {
    return this._ended;
  }
  get seeking() {
    return this._seeking;
  }
  get readyState() {
    if (!this.ready) return 0;
    if (this.ytState === YT_STATE.BUFFERING) return HAVE_METADATA;
    if (this.ytState === YT_STATE.PLAYING || this._ended) return 4;
    // Paused/cued: like <video>, "can play" means some video is loaded ahead. If YouTube doesn't keep
    // loading while paused, give up waiting after a few seconds so the room isn't held forever.
    const waitedLong = this.dataWaitSince !== null && Date.now() - this.dataWaitSince > 6000;
    if (this.dataWaitSince === null || waitedLong || this.bufferedAhead() >= MIN_AHEAD_SEC) return 4;
    return HAVE_METADATA;
  }
  get duration() {
    const d = this.player && this.ready ? this.player.getDuration() : 0;
    return d > 0 ? d : NaN;
  }
  get currentTime() {
    if (this._seeking) return this.seekTarget;
    return this.player && this.ready ? this.player.getCurrentTime() : 0;
  }
  set currentTime(t: number) {
    if (!this.player || !this.ready) return;
    this.seekTarget = Math.max(0, t);
    this._seeking = true;
    this.emit("seeking");
    this.player.seekTo(this.seekTarget, true);
  }
  get playbackRate() {
    return this._rate;
  }
  set playbackRate(r: number) {
    if (r === this._rate) return;
    this._rate = r;
    // YouTube accepts 0.95/1.05 (measured), so drift correction works as on <video>.
    this.player?.setPlaybackRate(r);
    this.emit("ratechange");
  }
  get volume() {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = Math.min(1, Math.max(0, v));
    this.player?.setVolume(Math.round(this._volume * 100));
    this.emit("volumechange");
  }
  get muted() {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    if (m) this.player?.mute();
    else this.player?.unMute();
    this.emit("volumechange");
  }
  get buffered() {
    const end = (this.player && this.ready ? this.player.getVideoLoadedFraction() : 0) * (this.duration || 0);
    return { length: end > 0 ? 1 : 0, end: () => end };
  }

  /** Video title as YouTube reports it (empty until loaded). */
  get title(): string {
    return (this.ready && this.player?.getVideoData().title) || "";
  }

  play(): Promise<void> {
    if (!this.player || !this.ready) return Promise.reject(new DOMException("Not ready", "InvalidStateError"));
    if (this._paused) {
      this._paused = false;
      this._ended = false;
      this.emit("play");
    }
    this.player.playVideo();
    // Autoplay can be blocked without any error from YouTube: if it hasn't started shortly, say so like
    // <video> does (useSync then shows "Join & sync" again).
    return new Promise((resolve, reject) => {
      const started = () => this.ytState === YT_STATE.PLAYING || this.ytState === YT_STATE.BUFFERING;
      if (started()) return resolve();
      const t0 = Date.now();
      const check = setInterval(() => {
        if (started() || this._paused || this.destroyed) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - t0 > 2500) {
          clearInterval(check);
          // Quietly back to paused: a "pause" event here would be written to the room as a user pause.
          this._paused = true;
          reject(new DOMException("Playback was blocked", "NotAllowedError"));
        }
      }, 100);
    });
  }

  pause() {
    if (!this._paused) {
      this._paused = true;
      this.emit("pause");
    }
    this.player?.pauseVideo();
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.player?.destroy();
    this.player = null;
  }
}
