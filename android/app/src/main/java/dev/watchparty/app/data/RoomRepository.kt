package dev.watchparty.app.data

import android.util.Log
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import dev.watchparty.app.BuildConfig
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

object RoomRepository {
    const val CHAT_HISTORY = 100
    const val TEST_HLS_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
    private const val TEST_DURATION_SEC = 634.0

    /** RTDB push ids: 20 chars of [-_0-9A-Za-z]. */
    private val ROOM_ID_RE = Regex("^[-_0-9A-Za-z]{16,40}$")

    /** Accepts a full invite link (https://…/room/<id>, watchparty://room/<id>) or a bare id. */
    fun parseRoomInput(input: String): String? {
        val trimmed = input.trim()
        val id = Regex("""(?:/room/|://room/)([^/?#\s]+)""").find(trimmed)?.groupValues?.get(1) ?: trimmed
        return id.takeIf { ROOM_ID_RE.matches(it) }
    }

    fun inviteLink(roomId: String) = "https://${BuildConfig.WEB_HOST}/room/$roomId"

    /** Self-join: membership must exist before any read under rooms/ or chats/ is allowed. */
    suspend fun join(roomId: String, uid: String) {
        Fb.ref(Paths.roomMember(roomId, uid)).setValue(true).await()
        Fb.ref(Paths.userRoom(uid, roomId)).setValue(true).await()
    }

    /** Undo a join (the link pointed at a room that doesn't exist). */
    suspend fun forget(roomId: String, uid: String) {
        runCatching { Fb.ref(Paths.roomMember(roomId, uid)).removeValue().await() }
        runCatching { Fb.ref(Paths.userRoom(uid, roomId)).removeValue().await() }
    }

    suspend fun createTestRoom(uid: String): String {
        val roomId = Fb.ref("rooms").push().key ?: error("Could not allocate a room id")
        // Membership first: rules check it against existing data.
        join(roomId, uid)
        Fb.db.reference.updateChildren(
            mapOf(
                Paths.roomMeta(roomId) to mapOf(
                    "title" to "Test room: Big Buck Bunny",
                    "hostUid" to uid,
                    "createdAt" to ServerValue.TIMESTAMP,
                    "videoId" to "test-bbb",
                    "hlsUrl" to TEST_HLS_URL,
                    "durationSec" to TEST_DURATION_SEC,
                ),
                Paths.roomState(roomId) to mapOf(
                    "playing" to false,
                    "position" to 0,
                    "updatedAt" to ServerValue.TIMESTAMP,
                    "rate" to 1,
                    "rev" to 0,
                    "by" to uid,
                ),
            ),
        ).await()
        return roomId
    }

    fun userRoomIds(uid: String): Flow<List<String>> =
        Fb.ref(Paths.userRooms(uid)).snapshots().map { s -> s.children.mapNotNull { it.key } }

    /** Metas for the "my rooms" list, newest first; rooms that vanished are skipped. */
    suspend fun loadMetas(ids: List<String>): List<Pair<String, RoomMeta>> = coroutineScope {
        ids.map { id ->
            async { runCatching { Fb.ref(Paths.roomMeta(id)).get().await().toRoomMeta() }.getOrNull()?.let { id to it } }
        }.awaitAll().filterNotNull().sortedByDescending { it.second.createdAt }
    }

    fun meta(roomId: String) = Fb.ref(Paths.roomMeta(roomId)).snapshots().map { it.toRoomMeta() }
    fun state(roomId: String) = Fb.ref(Paths.roomState(roomId)).snapshots().map { it.toPlaybackState() }
    fun presence(roomId: String) = Fb.ref(Paths.roomPresence(roomId)).snapshots().map { it.toPresenceMap() }
    fun chat(roomId: String) =
        Fb.ref(Paths.chat(roomId)).orderByChild("ts").limitToLast(CHAT_HISTORY).snapshots().map { it.toChatMessages() }

    suspend fun sendChat(roomId: String, user: AppUser, text: String) {
        Fb.ref(Paths.chat(roomId)).push().setValue(
            mapOf(
                "uid" to user.uid,
                "name" to user.displayName,
                "text" to text.take(CHAT_MAX_LENGTH),
                "ts" to ServerValue.TIMESTAMP,
            ),
        ).await()
    }

    fun writeState(roomId: String, uid: String, playing: Boolean, positionSec: Double, prevRev: Long) {
        Fb.ref(Paths.roomState(roomId)).setValue(
            mapOf(
                "playing" to playing,
                "position" to positionSec,
                "updatedAt" to ServerValue.TIMESTAMP,
                "rate" to 1,
                "rev" to prevRev + 1,
                "by" to uid,
            ),
        ).addOnFailureListener { Log.w("WatchParty", "state write failed", it) }
    }
}

/**
 * Keeps rooms/{id}/presence/{uid} up to date: online while connected and in the foreground,
 * cleared by the server via onDisconnect if the app dies or loses network.
 */
class PresenceController(private val roomId: String, private val user: AppUser) {
    private val ref = Fb.ref(Paths.roomPresenceUser(roomId, user.uid))
    private val connectedRef = Fb.ref(Paths.CONNECTED)
    private var foreground = true
    private var buffering = false
    private var connected = false

    private val offline get() = mapOf("online" to false, "buffering" to false, "lastSeen" to ServerValue.TIMESTAMP)

    private val connectedListener = object : ValueEventListener {
        override fun onDataChange(snapshot: DataSnapshot) {
            connected = snapshot.getValue(Boolean::class.java) == true
            if (connected) publish()
        }

        override fun onCancelled(error: DatabaseError) = Unit
    }

    fun start() = connectedListener.also { connectedRef.addValueEventListener(it) }

    fun setForeground(fg: Boolean) {
        foreground = fg
        if (connected) publish()
    }

    fun setBuffering(b: Boolean) {
        if (buffering == b) return
        buffering = b
        if (connected && foreground) ref.updateChildren(mapOf("buffering" to b))
    }

    private fun publish() {
        if (foreground) {
            ref.onDisconnect().updateChildren(offline)
            ref.setValue(
                mapOf("online" to true, "buffering" to buffering, "name" to user.displayName, "lastSeen" to ServerValue.TIMESTAMP),
            )
        } else {
            ref.updateChildren(offline)
        }
    }

    fun stop() {
        connectedRef.removeEventListener(connectedListener)
        ref.onDisconnect().cancel()
        ref.updateChildren(offline)
    }
}
