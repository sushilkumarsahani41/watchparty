package dev.watchparty.app.data

import com.google.firebase.database.DataSnapshot

/**
 * Mirrors packages/shared/src/types.ts and paths.ts. Values are read by hand from snapshots
 * (no reflection) so numbers stored as Long or Double both work and R8 needs no keep rules.
 */
object Paths {
    fun user(uid: String) = "users/$uid"
    fun userRooms(uid: String) = "userRooms/$uid"
    fun userRoom(uid: String, roomId: String) = "userRooms/$uid/$roomId"
    fun roomMembers(roomId: String) = "roomMembers/$roomId"
    fun roomMember(roomId: String, uid: String) = "roomMembers/$roomId/$uid"
    fun room(roomId: String) = "rooms/$roomId"
    fun roomMeta(roomId: String) = "rooms/$roomId/meta"
    fun roomState(roomId: String) = "rooms/$roomId/state"
    fun roomPresence(roomId: String) = "rooms/$roomId/presence"
    fun roomPresenceUser(roomId: String, uid: String) = "rooms/$roomId/presence/$uid"
    fun chat(roomId: String) = "chats/$roomId"
    const val SERVER_TIME_OFFSET = ".info/serverTimeOffset"
    const val CONNECTED = ".info/connected"
}

const val CHAT_MAX_LENGTH = 1000

data class RoomMeta(
    val title: String,
    val hostUid: String,
    val createdAt: Long,
    /** "hls" (uploaded) or "youtube". Missing in rooms created before YouTube support = "hls". */
    val source: String,
    val videoId: String,
    val hlsUrl: String,
    val youtubeId: String?,
    val durationSec: Double,
) {
    val isYouTube get() = source == "youtube" && !youtubeId.isNullOrBlank()
}

data class PlaybackState(
    val playing: Boolean,
    val position: Double,
    val updatedAt: Long,
    val rate: Double,
    val rev: Long,
    val by: String,
)

data class Presence(
    val online: Boolean,
    val buffering: Boolean,
    val name: String,
    val lastSeen: Long,
)

data class ChatMessage(
    val id: String,
    val uid: String,
    val name: String,
    val text: String,
    val ts: Long?,
)

private fun DataSnapshot.num(key: String): Double? = (child(key).value as? Number)?.toDouble()
private fun DataSnapshot.long(key: String): Long? = (child(key).value as? Number)?.toLong()
private fun DataSnapshot.str(key: String): String? = child(key).value as? String
private fun DataSnapshot.bool(key: String): Boolean? = child(key).value as? Boolean

fun DataSnapshot.toRoomMeta(): RoomMeta? {
    if (!exists()) return null
    return RoomMeta(
        title = str("title") ?: "Untitled",
        hostUid = str("hostUid") ?: "",
        createdAt = long("createdAt") ?: 0L,
        source = str("source") ?: "hls",
        videoId = str("videoId") ?: "",
        hlsUrl = str("hlsUrl") ?: "",
        youtubeId = str("youtubeId"),
        durationSec = num("durationSec") ?: 0.0,
    ).takeIf { it.isYouTube || it.hlsUrl.isNotBlank() }
}

fun DataSnapshot.toPlaybackState(): PlaybackState? {
    if (!exists()) return null
    return PlaybackState(
        playing = bool("playing") ?: false,
        position = num("position") ?: 0.0,
        updatedAt = long("updatedAt") ?: 0L,
        rate = num("rate") ?: 1.0,
        rev = long("rev") ?: 0L,
        by = str("by") ?: "",
    )
}

fun DataSnapshot.toPresenceMap(): Map<String, Presence> =
    children.mapNotNull { c ->
        val uid = c.key ?: return@mapNotNull null
        uid to Presence(
            online = c.bool("online") ?: false,
            buffering = c.bool("buffering") ?: false,
            name = c.str("name") ?: "Someone",
            lastSeen = c.long("lastSeen") ?: 0L,
        )
    }.toMap()

fun DataSnapshot.toChatMessages(): List<ChatMessage> =
    children.mapNotNull { c ->
        ChatMessage(
            id = c.key ?: return@mapNotNull null,
            uid = c.str("uid") ?: "",
            name = c.str("name") ?: "Someone",
            text = c.str("text") ?: "",
            ts = c.long("ts"),
        )
    }
