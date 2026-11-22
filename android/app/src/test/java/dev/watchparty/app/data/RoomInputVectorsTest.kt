package dev.watchparty.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Runs the shared vectors (packages/shared/src/rooms.vectors.json) against the Kotlin port. */
class RoomInputVectorsTest {
    private val vectors: JSONObject by lazy {
        val path = System.getProperty("roomVectors") ?: error("roomVectors system property not set")
        JSONObject(File(path).readText())
    }

    private fun cases(name: String) = vectors.getJSONArray(name).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    private fun JSONObject.expectedOrNull() = if (isNull("expected")) null else getString("expected")

    @Test
    fun parseRoomInput() {
        val all = cases("parseRoomInput")
        check(all.isNotEmpty())
        for (c in all) assertEquals(c.getString("input"), c.expectedOrNull(), RoomInput.parseRoomInput(c.getString("input")))
    }

    @Test
    fun formatRoomCode() {
        for (c in cases("formatRoomCode")) assertEquals(c.getString("expected"), RoomInput.format(c.getString("input")))
    }

    @Test
    fun parseYouTubeId() {
        val all = cases("parseYouTubeId")
        check(all.isNotEmpty())
        for (c in all) assertEquals(c.getString("input"), c.expectedOrNull(), RoomInput.parseYouTubeId(c.getString("input")))
    }

    @Test
    fun generatedCodesUseTheAlphabet() {
        repeat(500) {
            val code = RoomInput.generateCode()
            assertEquals(8, code.length)
            assertTrue(code, code.all { it in RoomInput.ALPHABET })
            assertEquals(code, RoomInput.parseRoomInput(code))
        }
    }
}
