package dev.watchparty.app.sync

import dev.watchparty.app.sync.SyncMath.DriftDecision
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** Runs the shared vectors (packages/shared/src/sync.vectors.json) against the Kotlin port. */
class SyncVectorsTest {
    private val vectors: JSONObject by lazy {
        val path = System.getProperty("syncVectors") ?: error("syncVectors system property not set")
        JSONObject(File(path).readText())
    }

    private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }

    @Test
    fun expectedPosition() {
        val cases = vectors.getJSONArray("expectedPosition").objects()
        check(cases.isNotEmpty())
        for (c in cases) {
            val s = c.getJSONObject("state")
            val actual = SyncMath.expectedPosition(
                playing = s.getBoolean("playing"),
                position = s.getDouble("position"),
                updatedAt = s.getLong("updatedAt"),
                rate = s.getDouble("rate"),
                serverNowMs = c.getLong("now"),
                durationSec = if (c.has("durationSec")) c.getDouble("durationSec") else null,
            )
            assertEquals(c.getString("name"), c.getDouble("expected"), actual, 1e-9)
        }
    }

    @Test
    fun decideDrift() {
        val cases = vectors.getJSONArray("decideDrift").objects()
        check(cases.isNotEmpty())
        for (c in cases) {
            val i = c.getJSONObject("input")
            val r = c.getJSONObject("result")
            val expected = when (r.getString("action")) {
                "none" -> DriftDecision.None
                "seek" -> DriftDecision.Seek(r.getDouble("to"))
                "rate" -> DriftDecision.Rate(r.getDouble("rate"))
                else -> error("unknown action")
            }
            val actual = SyncMath.decideDrift(
                currentTime = i.getDouble("currentTime"),
                expected = i.getDouble("expected"),
                playing = i.getBoolean("playing"),
                currentRate = i.getDouble("currentRate"),
            )
            assertEquals(c.getString("name"), expected, actual)
        }
    }

    @Test
    fun bufferingGate() {
        val cases = vectors.getJSONArray("bufferingGate").objects()
        check(cases.isNotEmpty())
        for (c in cases) {
            val presence = c.optJSONObject("presence")?.let { p ->
                p.keys().asSequence().associateWith { uid ->
                    val o = p.getJSONObject(uid)
                    SyncMath.PresenceLite(o.getBoolean("online"), o.getBoolean("buffering"))
                }
            }
            val expectedBuffering = c.getJSONArray("buffering").let { a -> (0 until a.length()).map(a::getString) }
            assertEquals(c.getString("name"), expectedBuffering, SyncMath.bufferingParticipants(presence))
            assertEquals(
                c.getString("name"),
                c.getBoolean("effectivePlaying"),
                SyncMath.effectivePlaying(c.getBoolean("statePlaying"), presence),
            )
        }
    }
}
