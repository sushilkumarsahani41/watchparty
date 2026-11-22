package dev.watchparty.app.ui

import android.app.Application
import androidx.annotation.OptIn
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import dev.watchparty.app.BuildConfig
import dev.watchparty.app.data.AppUser
import dev.watchparty.app.data.ChatMessage
import dev.watchparty.app.data.Fb
import dev.watchparty.app.data.Paths
import dev.watchparty.app.data.PlaybackState
import dev.watchparty.app.data.Presence
import dev.watchparty.app.data.PresenceController
import dev.watchparty.app.data.RoomMeta
import dev.watchparty.app.data.RoomRepository
import dev.watchparty.app.data.snapshots
import dev.watchparty.app.sync.ExoSyncPlayer
import dev.watchparty.app.sync.ServerTime
import dev.watchparty.app.sync.SyncEngine
import dev.watchparty.app.sync.SyncPlayer
import dev.watchparty.app.sync.YouTubeSyncPlayer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

sealed interface RoomStatus {
    data object Joining : RoomStatus
    data class Ready(val meta: RoomMeta) : RoomStatus
    data object NotFound : RoomStatus
    data class Error(val message: String) : RoomStatus
}

/** One selectable video quality (a track inside the HLS video group). */
data class QualityOption(val height: Int, val groupIndex: Int, val trackIndex: Int)

class RoomViewModel(app: Application, val roomId: String, val user: AppUser) : AndroidViewModel(app) {
    private val _status = MutableStateFlow<RoomStatus>(RoomStatus.Joining)
    val status: StateFlow<RoomStatus> = _status.asStateFlow()

    private val _state = MutableStateFlow<PlaybackState?>(null)
    val state: StateFlow<PlaybackState?> = _state.asStateFlow()

    private val _presence = MutableStateFlow<Map<String, Presence>>(emptyMap())
    val presence: StateFlow<Map<String, Presence>> = _presence.asStateFlow()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _connected = MutableStateFlow(true)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val _qualities = MutableStateFlow<List<QualityOption>>(emptyList())
    val qualities: StateFlow<List<QualityOption>> = _qualities.asStateFlow()

    /** null = Auto (adaptive). */
    private val _selectedQuality = MutableStateFlow<Int?>(null)
    val selectedQuality: StateFlow<Int?> = _selectedQuality.asStateFlow()

    private val _playerError = MutableStateFlow<String?>(null)
    val playerError: StateFlow<String?> = _playerError.asStateFlow()

    /** Created once the room's meta says which kind of video it is. */
    private val _player = MutableStateFlow<SyncPlayer?>(null)
    val player: StateFlow<SyncPlayer?> = _player.asStateFlow()

    private var engine: SyncEngine? = null
    private var presenceController: PresenceController? = null
    private var roomGone = false
    val selfBuffering = MutableStateFlow(false)

    init {
        ServerTime.start()
        viewModelScope.launch { joinAndSubscribe() }
    }

    private fun markGone() {
        if (roomGone) return
        roomGone = true
        _status.value = RoomStatus.NotFound
        engine?.setActive(false)
        // Stop presence now: writing it after the room is gone would leave a stray node behind.
        presenceController?.stop(roomGone = true)
        presenceController = null
        viewModelScope.launch { RoomRepository.forget(roomId, user.uid) }
    }

    private suspend fun joinAndSubscribe() {
        try {
            RoomRepository.join(roomId, user.uid)
        } catch (e: Exception) {
            _status.value = RoomStatus.Error(e.message ?: "Couldn't join the room.")
            return
        }
        val onError: (Throwable) -> Unit = { e ->
            when {
                // After "not found" we drop membership, so later permission errors are expected.
                roomGone -> Unit
                // Losing access to a room we were in: the host deleted it (members go with the room).
                _status.value is RoomStatus.Ready && e.message?.contains("permission", ignoreCase = true) == true -> markGone()
                else -> _status.value = RoomStatus.Error(e.message ?: "Connection error")
            }
        }
        viewModelScope.launch {
            RoomRepository.meta(roomId).catch { onError(it) }.collect { meta ->
                if (meta == null) {
                    markGone()
                } else {
                    _status.value = RoomStatus.Ready(meta)
                    startPlayback(meta)
                }
            }
        }
        viewModelScope.launch {
            RoomRepository.state(roomId).catch { onError(it) }.collect { s ->
                _state.value = s
                engine?.onState(s)
            }
        }
        viewModelScope.launch {
            RoomRepository.presence(roomId).catch { onError(it) }.collect { p ->
                _presence.value = p
                engine?.onPresence(p)
            }
        }
        viewModelScope.launch {
            RoomRepository.chat(roomId).catch { onError(it) }.collect { _messages.value = it }
        }
        viewModelScope.launch {
            Fb.ref(Paths.CONNECTED).snapshots().map { it.value == true }.catch { }.collect { _connected.value = it }
        }
    }

    private fun startPlayback(meta: RoomMeta) {
        if (_player.value != null) return
        val p: SyncPlayer = if (meta.isYouTube) {
            YouTubeSyncPlayer(getApplication(), meta.youtubeId!!, BuildConfig.WEB_HOST).also { yt ->
                yt.onError = { _playerError.value = it }
            }
        } else {
            createExo(meta.hlsUrl)
        }
        _player.value = p

        presenceController = PresenceController(roomId, user).also { it.start() }
        engine = SyncEngine(
            player = p,
            scope = viewModelScope,
            durationFallbackSec = { meta.durationSec },
            writeState = { playing, pos, prevRev -> RoomRepository.writeState(roomId, user.uid, playing, pos, prevRev) },
            publishBuffering = { b ->
                selfBuffering.value = b
                if (!roomGone) presenceController?.setBuffering(b)
            },
        ).also { e ->
            e.onPresence(_presence.value)
            e.onState(_state.value)
        }
    }

    private fun createExo(url: String): ExoSyncPlayer {
        val exo = ExoPlayer.Builder(getApplication()).build()
        exo.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) {
                _qualities.value = tracks.groups.withIndex()
                    .filter { (_, g) -> g.type == C.TRACK_TYPE_VIDEO }
                    .flatMap { (gi, g) ->
                        (0 until g.length).filter { g.isTrackSupported(it) }.map { ti ->
                            QualityOption(g.getTrackFormat(ti).height, gi, ti)
                        }
                    }
                    .filter { it.height > 0 }
                    .distinctBy { it.height }
                    .sortedByDescending { it.height }
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                _playerError.value = "This video can't be played (${error.errorCodeName})."
            }
        })
        exo.setMediaItem(MediaItem.Builder().setUri(url).setMimeType(MimeTypes.APPLICATION_M3U8).build())
        exo.prepare()
        return ExoSyncPlayer(exo)
    }

    /** Height of the video currently playing (uploads only), for the "Auto (720p)" label. */
    fun activeHeight(): Int = (_player.value as? ExoSyncPlayer)?.exo?.videoFormat?.height ?: 0

    // --- UI actions ---

    fun togglePlay() = engine?.userTogglePlay()
    fun seekBy(deltaSec: Double) = engine?.userSeekBy(deltaSec)
    fun seekTo(sec: Double) = engine?.userSeekTo(sec)

    /** App moved to/from background. */
    fun setForeground(fg: Boolean) {
        if (roomGone) return
        presenceController?.setForeground(fg)
        engine?.setActive(fg)
    }

    @OptIn(UnstableApi::class)
    fun selectQuality(option: QualityOption?) {
        val exo = (_player.value as? ExoSyncPlayer)?.exo ?: return
        val params = exo.trackSelectionParameters.buildUpon()
        if (option == null) {
            params.clearOverridesOfType(C.TRACK_TYPE_VIDEO)
        } else {
            val group = exo.currentTracks.groups.getOrNull(option.groupIndex) ?: return
            params.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, option.trackIndex))
        }
        exo.trackSelectionParameters = params.build()
        _selectedQuality.value = option?.height
    }

    fun sendChat(text: String, onFailed: () -> Unit) {
        val body = text.trim()
        if (body.isEmpty()) return
        viewModelScope.launch {
            try {
                RoomRepository.sendChat(roomId, user, body)
            } catch (_: Exception) {
                onFailed()
            }
        }
    }

    override fun onCleared() {
        engine?.release()
        presenceController?.stop(roomGone)
        _player.value?.release()
    }
}
