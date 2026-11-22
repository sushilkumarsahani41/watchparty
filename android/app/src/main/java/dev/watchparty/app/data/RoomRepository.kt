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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object RoomRepository {
    const val CHAT_HISTORY = 100
    const val TEST_HLS_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
    private const val TEST_DURATION_SEC = 634.0

    /** Accepts an invite link, a room code (any case, spaces/dashes ok) or a legacy room id. */
    fun parseRoomInput(input: String): String? = RoomInput.parseRoomInput(input)

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

    /**
     * Create a room under a fresh room code (same steps as createRoomWithCode in packages/shared/src/rooms.ts):
     * membership first (rules check it against existing data); if the code is taken, undo and try another.
     */
    private suspend fun createRoom(uid: String, meta: Map<String, Any?>): String {
        repeat(5) {
            val roomId = RoomInput.generateCode()
            join(roomId, uid)
            if (Fb.ref(Paths.roomMeta(roomId)).get().await().exists()) {
                forget(roomId, uid)
                return@repeat
            }
            Fb.db.reference.updateChildren(
                mapOf(
                    Paths.roomMeta(roomId) to meta + mapOf("hostUid" to uid, "createdAt" to ServerValue.TIMESTAMP),
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
        error("Couldn't find a free room code. Try again.")
    }

    suspend fun createTestRoom(uid: String): String = createRoom(
        uid,
        mapOf(
            "title" to "Test room: Big Buck Bunny",
            "source" to "hls",
            "videoId" to "test-bbb",
            "hlsUrl" to TEST_HLS_URL,
            "durationSec" to TEST_DURATION_SEC,
        ),
    )

    /** Title (and a check that the video exists and may be embedded) via YouTube oEmbed. */
    private suspend fun youTubeTitle(youtubeId: String): String = withContext(Dispatchers.IO) {
        val url = URL(
            "https://www.youtube.com/oembed?format=json&url=" +
                URLEncoder.encode("https://www.youtube.com/watch?v=$youtubeId", "UTF-8"),
        )
        val conn = try {
            (url.openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 8000 }
        } catch (_: Exception) {
            return@withContext "YouTube video"
        }
        try {
            when (val code = runCatching { conn.responseCode }.getOrDefault(-1)) {
                401, 403 -> throw IllegalStateException("The owner of this video doesn't allow playing it outside YouTube.")
                400, 404 -> throw IllegalStateException("That YouTube video doesn't exist or is private.")
                200 -> JSONObject(conn.inputStream.bufferedReader().readText()).optString("title").trim().ifEmpty { "YouTube video" }
                else -> { Log.w("WatchParty", "oEmbed returned $code"); "YouTube video" }
            }
        } finally {
            conn.disconnect()
        }
    }

    suspend fun createYouTubeRoom(uid: String, youtubeId: String): String = createRoom(
        uid,
        mapOf(
            "title" to youTubeTitle(youtubeId),
            "source" to "youtube",
            "youtubeId" to youtubeId,
            "videoId" to "",
            "hlsUrl" to "",
            "durationSec" to 0,
        ),
    )

    /** Delete a room you host (rules allow only the host): room, members and chat, in one update. */
    suspend fun deleteRoom(roomId: String, uid: String) {
        Fb.db.reference.updateChildren(
            mapOf(
                Paths.room(roomId) to null,
                Paths.roomMembers(roomId) to null,
                Paths.chat(roomId) to null,
                Paths.userRoom(uid, roomId) to null,
            ),
        ).await()
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

    /** @param roomGone the room was deleted: don't write a presence node back into it. */
    fun stop(roomGone: Boolean = false) {
        connectedRef.removeEventListener(connectedListener)
        ref.onDisconnect().cancel()
        if (!roomGone) ref.updateChildren(offline)
    }
}
