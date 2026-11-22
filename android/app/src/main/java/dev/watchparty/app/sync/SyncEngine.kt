package dev.watchparty.app.sync

import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import dev.watchparty.app.BuildConfig
import dev.watchparty.app.data.PlaybackState
import dev.watchparty.app.data.Presence
import dev.watchparty.app.sync.SyncMath.DriftDecision
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Android port of web/src/lib/useSync.ts.
 *
 * Unlike the web, user actions come only from our own controls, so they call [userPlay] /
 * [userPause] / [userSeekTo] which write shared state directly. Programmatic corrections never
 * write, so echo loops are impossible without guard flags.
 *
 * Must be used on the main thread (ExoPlayer and Firebase callbacks both run there).
 */
class SyncEngine(
    private val player: ExoPlayer,
    private val scope: CoroutineScope,
    private val durationFallbackSec: () -> Double,
    /** Write rooms/{id}/state. */
    private val writeState: (playing: Boolean, positionSec: Double, prevRev: Long) -> Unit,
    /** Publish own presence.buffering. */
    private val publishBuffering: (Boolean) -> Unit,
) {
    private companion object {
        const val HEARTBEAT_MS = 5_000L
        const val BUFFERING_DEBOUNCE_MS = 400L
        const val SEEK_WRITE_DEBOUNCE_MS = 250L
    }

    private var state: PlaybackState? = null
    private var presence: Map<String, SyncMath.PresenceLite> = emptyMap()
    private var active = true
    private var localSeekPending = false
    private var seekWriteJob: Job? = null
    private var bufferingJob: Job? = null

    private fun debug(msg: String) {
        if (BuildConfig.DEBUG) Log.d("WPSync", msg)
    }

    private fun write(reason: String, playing: Boolean, pos: Double) {
        debug("write $reason playing=$playing pos=${"%.2f".format(pos)}")
        val prev = state
        writeState(playing, pos, prev?.rev ?: 0)
        // Use our write immediately: the snapshot arrives a moment later, and reconciling against the
        // old state in between would seek away and straight back.
        state = PlaybackState(playing, pos, ServerTime.now(), 1.0, (prev?.rev ?: 0) + 1, prev?.by ?: "")
    }

    private val _selfBuffering = MutableStateFlow(false)
    val selfBuffering: StateFlow<Boolean> = _selfBuffering.asStateFlow()

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_BUFFERING -> {
                    if (bufferingJob?.isActive != true) {
                        bufferingJob = scope.launch {
                            delay(BUFFERING_DEBOUNCE_MS)
                            setBuffering(true)
                        }
                    }
                }
                Player.STATE_READY, Player.STATE_ENDED, Player.STATE_IDLE -> {
                    bufferingJob?.cancel()
                    setBuffering(false)
                    if (playbackState == Player.STATE_READY) reconcile()
                }
            }
        }
    }

    private val heartbeat: Job

    init {
        player.addListener(listener)
        heartbeat = scope.launch {
            while (isActive) {
                delay(HEARTBEAT_MS)
                if (_selfBuffering.value && player.playbackState == Player.STATE_READY) setBuffering(false)
                reconcile()
                if (BuildConfig.DEBUG) {
                    val drift = state?.let { s ->
                        positionSec() - SyncMath.expectedPosition(s.playing, s.position, s.updatedAt, s.rate, ServerTime.now(), durationSec())
                    }
                    debug("tick pos=${"%.2f".format(positionSec())} drift=${drift?.let { "%+.3f".format(it) }} playing=${player.isPlaying} rate=${player.playbackParameters.speed} buffering=${_selfBuffering.value}")
                }
            }
        }
    }

    fun onState(s: PlaybackState?) {
        state = s
        reconcile()
    }

    fun onPresence(p: Map<String, Presence>) {
        presence = p.mapValues { (_, v) -> SyncMath.PresenceLite(v.online, v.buffering) }
        reconcile()
    }

    /** App in background: stop playback locally and stop chasing the room. */
    fun setActive(isActive: Boolean) {
        active = isActive
        if (!isActive) player.playWhenReady = false else reconcile()
    }

    // --- User actions (written to shared state) ---

    fun userPlay() {
        write("play", true, positionSec())
        player.playWhenReady = true
    }

    fun userPause() {
        write("pause", false, positionSec())
        player.playWhenReady = false
    }

    fun userTogglePlay() = if (state?.playing == true) userPause() else userPlay()

    fun userSeekBy(deltaSec: Double) = userSeekTo(positionSec() + deltaSec)

    fun userSeekTo(targetSec: Double) {
        val clamped = targetSec.coerceIn(0.0, durationSec().takeIf { it > 0 } ?: Double.MAX_VALUE)
        player.seekTo((clamped * 1000).toLong())
        // Collapse rapid taps into one write; hold off reconcile so it doesn't pull us back meanwhile.
        localSeekPending = true
        seekWriteJob?.cancel()
        seekWriteJob = scope.launch {
            delay(SEEK_WRITE_DEBOUNCE_MS)
            localSeekPending = false
            // Keep the room's play/pause intent; only the position changed.
            write("seek", state?.playing ?: player.playWhenReady, positionSec())
        }
    }

    // --- Applying remote state ---

    private fun positionSec() = player.currentPosition / 1000.0

    private fun durationSec(): Double {
        val d = player.duration
        return if (d != C.TIME_UNSET && d > 0) d / 1000.0 else durationFallbackSec()
    }

    /** Bring the local player in line with shared state + buffering gate. */
    fun reconcile() {
        val s = state ?: return
        if (!active || localSeekPending) return
        if (player.playbackState == Player.STATE_IDLE) return

        val shouldPlay = SyncMath.effectivePlaying(s.playing, presence)
        val gated = s.playing && !shouldPlay

        // While anyone is buffering, everyone holds still; don't chase the advancing clock.
        if (!gated) {
            val expected = SyncMath.expectedPosition(s.playing, s.position, s.updatedAt, s.rate, ServerTime.now(), durationSec())
            when (val d = SyncMath.decideDrift(positionSec(), expected, shouldPlay, player.playbackParameters.speed.toDouble())) {
                is DriftDecision.Seek -> {
                    debug("correct seek ${"%.2f".format(positionSec())} -> ${"%.2f".format(d.to)}")
                    player.seekTo((d.to * 1000).toLong())
                }
                is DriftDecision.Rate -> player.playbackParameters = PlaybackParameters(d.rate.toFloat())
                DriftDecision.None -> Unit
            }
        } else if (player.playbackParameters.speed != 1f) {
            player.playbackParameters = PlaybackParameters(1f)
        }

        val wantPlay = shouldPlay && player.playbackState != Player.STATE_ENDED
        if (player.playWhenReady != wantPlay) player.playWhenReady = wantPlay
    }

    private fun setBuffering(b: Boolean) {
        if (_selfBuffering.value == b) return
        _selfBuffering.value = b
        publishBuffering(b)
        if (!b) onRecovered()
    }

    /** After we stalled, if we fell well behind, make our position the shared one so nobody skips ahead. */
    private fun onRecovered() {
        val s = state ?: return
        if (!s.playing || !active) return
        val expected = SyncMath.expectedPosition(s.playing, s.position, s.updatedAt, s.rate, ServerTime.now(), durationSec())
        if (expected - positionSec() > SyncMath.SEEK_THRESHOLD) write("recovered", true, positionSec())
        else reconcile()
    }

    fun release() {
        heartbeat.cancel()
        seekWriteJob?.cancel()
        bufferingJob?.cancel()
        player.removeListener(listener)
        if (_selfBuffering.value) publishBuffering(false)
    }
}
