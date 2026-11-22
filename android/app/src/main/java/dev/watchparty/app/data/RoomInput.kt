package dev.watchparty.app.data

import java.security.SecureRandom

/**
 * Kotlin port of the room-code and YouTube-link helpers in packages/shared/src/rooms.ts.
 * Both must pass packages/shared/src/rooms.vectors.json (RoomInputVectorsTest); change them together.
 */
object RoomInput {
    /** 32 letters without look-alikes (no 0/O, 1/I). The code is the room id. */
    const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    const val CODE_LENGTH = 8

    private val random = SecureRandom()
    private val CODE_RE = Regex("^[A-Z0-9]{8}$")
    /** Rooms created before codes existed use RTDB push ids. */
    private val LEGACY_ID_RE = Regex("^[-_0-9A-Za-z]{16,40}$")
    private val LINK_RE = Regex("""/room/([^/?#\s]+)""")

    /** 256 is a multiple of 32, so `byte % 32` is unbiased. */
    fun generateCode(): String {
        val bytes = ByteArray(CODE_LENGTH).also(random::nextBytes)
        return bytes.joinToString("") { ALPHABET[(it.toInt() and 0xFF) % 32].toString() }
    }

    /** "ABCD2345" -> "ABCD-2345" for display; other ids unchanged. */
    fun format(roomId: String) = if (CODE_RE.matches(roomId)) "${roomId.take(4)}-${roomId.drop(4)}" else roomId

    /** Room id from an invite link, a code in any case with spaces/dashes, or a legacy id; null otherwise. */
    fun parseRoomInput(input: String): String? {
        val trimmed = input.trim()
        val id = LINK_RE.find(trimmed)?.groupValues?.get(1) ?: trimmed
        val code = id.replace(Regex("""[\s-]"""), "").uppercase()
        if (CODE_RE.matches(code)) return code
        if (LEGACY_ID_RE.matches(id)) return id
        return null
    }

    private val YT_ID_RE = Regex("""^[\w-]{11}$""")
    private val YT_LONG_RE = Regex(
        """^(?:https?://)?(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/|v/)([\w-]{11})(?![\w-])""",
        RegexOption.IGNORE_CASE,
    )
    private val YT_SHORT_RE = Regex("""^(?:https?://)?youtu\.be/([\w-]{11})(?![\w-])""", RegexOption.IGNORE_CASE)

    /** YouTube video id from a link or a bare 11-character id; null otherwise. */
    fun parseYouTubeId(input: String): String? {
        val s = input.trim()
        if (YT_ID_RE.matches(s)) return s
        return (YT_LONG_RE.find(s) ?: YT_SHORT_RE.find(s))?.groupValues?.get(1)
    }
}
