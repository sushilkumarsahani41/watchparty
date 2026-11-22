package dev.watchparty.app.sync

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.media3.common.C
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * What the sync engine and the player UI need from a player. [ExoSyncPlayer] wraps Media3 (uploaded HLS
 * videos); [YouTubeSyncPlayer] wraps the YouTube IFrame player in a WebView.
 * All calls on the main thread.
 */
interface SyncPlayer {
    enum class Phase { Idle, Buffering, Ready, Ended }

    val phase: Phase
    val positionSec: Double
    /** 0 while unknown. */
    val durationSec: Double
    val bufferedSec: Double
    val speed: Double
    var playWhenReady: Boolean
    val isPlaying: Boolean

    fun setSpeed(speed: Double)
    fun seekTo(sec: Double)
    fun addListener(l: (Phase) -> Unit)
    fun removeListener(l: (Phase) -> Unit)
    fun release()
}

class ExoSyncPlayer(val exo: ExoPlayer) : SyncPlayer {
    private val listeners = mutableMapOf<(SyncPlayer.Phase) -> Unit, Player.Listener>()

    override val phase
        get() = when (exo.playbackState) {
            Player.STATE_BUFFERING -> SyncPlayer.Phase.Buffering
            Player.STATE_READY -> SyncPlayer.Phase.Ready
            Player.STATE_ENDED -> SyncPlayer.Phase.Ended
            else -> SyncPlayer.Phase.Idle
        }
    override val positionSec get() = exo.currentPosition / 1000.0
    override val durationSec get() = exo.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.let { it / 1000.0 } ?: 0.0
    override val bufferedSec get() = exo.bufferedPosition / 1000.0
    override val speed get() = exo.playbackParameters.speed.toDouble()
    override var playWhenReady
        get() = exo.playWhenReady
        set(v) {
            exo.playWhenReady = v
        }
    override val isPlaying get() = exo.isPlaying

    override fun setSpeed(speed: Double) {
        exo.playbackParameters = PlaybackParameters(speed.toFloat())
    }

    override fun seekTo(sec: Double) = exo.seekTo((sec * 1000).toLong())

    override fun addListener(l: (SyncPlayer.Phase) -> Unit) {
        val pl = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) = l(phase)
        }
        listeners[l] = pl
        exo.addListener(pl)
    }

    override fun removeListener(l: (SyncPlayer.Phase) -> Unit) {
        listeners.remove(l)?.let { exo.removeListener(it) }
    }

    override fun release() = exo.release()
}

/**
 * YouTube IFrame player in a WebView, driven through a small JS bridge. The page is loaded with an https
 * base URL on our web domain so YouTube sees a normal embedding origin.
 */
@SuppressLint("SetJavaScriptEnabled")
class YouTubeSyncPlayer(context: Context, youtubeId: String, embedHost: String) : SyncPlayer {
    private companion object {
        const val UNSTARTED = -1
        const val ENDED = 0
        const val PLAYING = 1
        const val PAUSED = 2
        const val BUFFERING = 3

        /** Loaded video ahead of the playhead before a paused player that was loading counts as ready. */
        const val MIN_AHEAD_SEC = 2.0
        const val MAX_DATA_WAIT_MS = 6000L
    }

    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<(SyncPlayer.Phase) -> Unit>()

    private var ready = false
    private var ytState = UNSTARTED
    private var lastTime = 0.0
    private var lastTickAt = 0L
    private var duration = 0.0
    private var loadedFraction = 0.0
    private var seekTarget: Double? = null
    private var _speed = 1.0
    private var wantPlay = false
    /** Paused while still loading: report Buffering until enough is loaded (or we've waited long enough). */
    private var dataWaitSince: Long? = null
    private var lastPhase = SyncPlayer.Phase.Idle

    /** Last YouTube error code, if any (see [errorMessage]). */
    var error: Int? = null
        private set
    var onError: ((String) -> Unit)? = null
    var onTitle: ((String) -> Unit)? = null

    val webView: WebView = WebView(context.applicationContext).apply {
        setBackgroundColor(Color.BLACK)
        settings.javaScriptEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.domStorageEnabled = true
        webChromeClient = WebChromeClient()
        webViewClient = object : WebViewClient() {
            // If the YouTube page's renderer dies, show an error instead of taking the whole app down.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.w("WatchParty", "YouTube renderer gone (crash=${detail.didCrash()})")
                ready = false
                onError?.invoke("The YouTube player stopped. Leave and rejoin the room.")
                notifyPhase(force = true)
                return true
            }
        }
        // Our controls are drawn on top; the frame itself must not take touches (they'd bypass sync).
        isFocusable = false
        addJavascriptInterface(Bridge(), "Android")
        loadDataWithBaseURL("https://$embedHost/", page(youtubeId, embedHost), "text/html", "utf-8", null)
    }

    private fun page(id: String, host: String) = """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%}</style>
        </head><body><div id="p"></div><script>
        var p, ready = false;
        function tick() {
          if (!ready) return;
          var d = p.getVideoData ? p.getVideoData() : {};
          Android.onTick(p.getCurrentTime(), p.getDuration() || 0, p.getVideoLoadedFraction() || 0, p.getPlayerState(), d && d.title || "");
        }
        function onYouTubeIframeAPIReady() {
          p = new YT.Player('p', {
            width: '100%', height: '100%', videoId: '$id',
            playerVars: { controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3, enablejsapi: 1, origin: 'https://$host' },
            events: {
              onReady: function () { ready = true; Android.onReady(p.getDuration() || 0); setInterval(tick, 250); tick(); },
              onStateChange: function (e) { Android.onState(e.data, p.getCurrentTime()); },
              onError: function (e) { Android.onError(e.data); }
            }
          });
        }
        </script><script src="https://www.youtube.com/iframe_api"></script></body></html>
    """.trimIndent()

    private fun js(code: String) {
        if (ready) webView.evaluateJavascript("p && p.$code", null)
    }

    private inner class Bridge {
        @JavascriptInterface
        fun onReady(d: Double) = main.post {
            ready = true
            duration = d
            js("setPlaybackRate($_speed)")
            if (wantPlay) js("playVideo()")
            notifyPhase(force = true)
        }

        @JavascriptInterface
        fun onState(state: Int, time: Double) = main.post {
            ytState = state
            updateTime(time)
            when (state) {
                PLAYING -> {
                    dataWaitSince = null
                    seekTarget = null
                }
                PAUSED -> {
                    seekTarget = null
                    if (lastPhase == SyncPlayer.Phase.Buffering && aheadSec() < MIN_AHEAD_SEC) dataWaitSince = SystemClock.elapsedRealtime()
                }
                ENDED -> seekTarget = null
            }
            notifyPhase()
        }

        @JavascriptInterface
        fun onTick(time: Double, d: Double, loaded: Double, state: Int, title: String) = main.post {
            if (d > 0) duration = d
            loadedFraction = loaded
            ytState = state
            if (seekTarget?.let { kotlin.math.abs(time - it) < 1.0 && state != BUFFERING } == true) seekTarget = null
            updateTime(time)
            if (title.isNotBlank()) onTitle?.invoke(title)
            notifyPhase()
        }

        @JavascriptInterface
        fun onError(code: Int) = main.post {
            Log.w("WatchParty", "YouTube error $code")
            error = code
            onError?.invoke(errorMessage(code))
        }
    }

    private fun updateTime(t: Double) {
        lastTime = t
        lastTickAt = SystemClock.elapsedRealtime()
    }

    private fun aheadSec() = loadedFraction * duration - lastTime

    private fun notifyPhase(force: Boolean = false) {
        val p = phase
        if (p != lastPhase || force) {
            lastPhase = p
            listeners.toList().forEach { it(p) }
        }
    }

    override val phase: SyncPlayer.Phase
        get() {
            if (!ready) return SyncPlayer.Phase.Idle
            return when (ytState) {
                BUFFERING -> SyncPlayer.Phase.Buffering
                ENDED -> SyncPlayer.Phase.Ended
                PLAYING -> SyncPlayer.Phase.Ready
                else -> {
                    val since = dataWaitSince
                    if (since != null && aheadSec() < MIN_AHEAD_SEC && SystemClock.elapsedRealtime() - since < MAX_DATA_WAIT_MS) {
                        SyncPlayer.Phase.Buffering
                    } else {
                        dataWaitSince = null
                        SyncPlayer.Phase.Ready
                    }
                }
            }
        }

    override val positionSec: Double
        get() {
            seekTarget?.let { return it }
            // Ticks come every 250 ms; extrapolate in between so drift is measured precisely.
            if (ytState != PLAYING) return lastTime
            return lastTime + (SystemClock.elapsedRealtime() - lastTickAt) / 1000.0 * _speed
        }
    override val durationSec get() = duration
    override val bufferedSec get() = loadedFraction * duration
    override val speed get() = _speed
    override var playWhenReady: Boolean
        get() = wantPlay
        set(v) {
            if (v == wantPlay) return
            wantPlay = v
            js(if (v) "playVideo()" else "pauseVideo()")
        }
    override val isPlaying get() = ytState == PLAYING

    override fun setSpeed(speed: Double) {
        if (speed == _speed) return
        _speed = speed
        // YouTube accepts 0.95/1.05 (measured), so drift correction works as with ExoPlayer.
        js("setPlaybackRate($speed)")
    }

    override fun seekTo(sec: Double) {
        if (!ready) return
        seekTarget = sec.coerceAtLeast(0.0)
        js("seekTo(${seekTarget}, true)")
    }

    override fun addListener(l: (SyncPlayer.Phase) -> Unit) {
        listeners += l
    }

    override fun removeListener(l: (SyncPlayer.Phase) -> Unit) {
        listeners -= l
    }

    override fun release() {
        listeners.clear()
        webView.removeJavascriptInterface("Android")
        webView.loadUrl("about:blank")
        webView.destroy()
    }

    fun errorMessage(code: Int) = when (code) {
        101, 150, 152 -> "The owner of this YouTube video doesn't allow playing it outside YouTube."
        100 -> "This YouTube video was removed or is private."
        2 -> "That isn't a valid YouTube video."
        else -> "YouTube can't play this video (error $code)."
    }
}
