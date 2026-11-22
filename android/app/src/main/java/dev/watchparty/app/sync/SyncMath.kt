package dev.watchparty.app.sync

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Kotlin port of packages/shared/src/sync.ts. Both must pass packages/shared/src/sync.vectors.json
 * (see SyncVectorsTest); change them together.
 */
object SyncMath {
    /** Drift above this (seconds) triggers a hard seek. */
    const val SEEK_THRESHOLD = 1.5
    /** Drift above this (seconds) while playing triggers rate correction. */
    const val RATE_THRESHOLD = 0.3
    /** Drift below this (seconds) restores normal rate. */
    const val RATE_RESTORE_THRESHOLD = 0.1
    const val SLOW_FACTOR = 0.95
    const val FAST_FACTOR = 1.05

    /**
     * Where the video should be right now, in seconds.
     * @param serverNowMs current server time (System.currentTimeMillis() + .info/serverTimeOffset)
     * @param durationSec optional clamp upper bound (null or <= 0 = no clamp)
     */
    fun expectedPosition(
        playing: Boolean,
        position: Double,
        updatedAt: Long,
        rate: Double,
        serverNowMs: Long,
        durationSec: Double? = null,
    ): Double {
        var pos = position
        if (playing) {
            val elapsedSec = max(0L, serverNowMs - updatedAt) / 1000.0
            pos += elapsedSec * (if (rate == 0.0) 1.0 else rate)
        }
        pos = max(0.0, pos)
        if (durationSec != null && durationSec > 0) pos = min(pos, durationSec)
        return pos
    }

    sealed interface DriftDecision {
        data object None : DriftDecision
        data class Seek(val to: Double) : DriftDecision
        data class Rate(val rate: Double) : DriftDecision
    }

    /** See sync.ts `decideDrift` for the rules; this must behave identically. */
    fun decideDrift(
        currentTime: Double,
        expected: Double,
        playing: Boolean,
        currentRate: Double,
        baseRate: Double = 1.0,
    ): DriftDecision {
        val drift = currentTime - expected
        val absDrift = abs(drift)

        if (absDrift > SEEK_THRESHOLD) return DriftDecision.Seek(expected)
        // While paused a seek is invisible, so align tightly instead of leaving it to rate correction later.
        if (!playing && absDrift > RATE_THRESHOLD) return DriftDecision.Seek(expected)

        if (playing && absDrift > RATE_THRESHOLD) {
            val rate = baseRate * (if (drift > 0) SLOW_FACTOR else FAST_FACTOR)
            return if (currentRate == rate) DriftDecision.None else DriftDecision.Rate(rate)
        }

        val isCorrecting = currentRate != baseRate
        // Crossed the target (sped up but now ahead, or slowed down but now behind): stop before overshooting.
        val overshot = (currentRate > baseRate && drift > 0) || (currentRate < baseRate && drift < 0)
        if (isCorrecting && (absDrift < RATE_RESTORE_THRESHOLD || overshot || !playing)) {
            return DriftDecision.Rate(baseRate)
        }
        return DriftDecision.None
    }

    data class PresenceLite(val online: Boolean, val buffering: Boolean)

    /** uids of online participants currently buffering, in map iteration order. */
    fun bufferingParticipants(presence: Map<String, PresenceLite>?): List<String> =
        presence.orEmpty().filter { (_, p) -> p.online && p.buffering }.keys.toList()

    /** Effective playing = shared state says playing AND no online participant is buffering. */
    fun effectivePlaying(statePlaying: Boolean?, presence: Map<String, PresenceLite>?): Boolean =
        statePlaying == true && bufferingParticipants(presence).isEmpty()
}
