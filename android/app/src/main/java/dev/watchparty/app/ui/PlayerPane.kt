package dev.watchparty.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.C
import androidx.media3.ui.compose.ContentFrame
import androidx.media3.ui.compose.SURFACE_TYPE_TEXTURE_VIEW
import dev.watchparty.app.data.PlaybackState
import dev.watchparty.app.data.Presence
import kotlinx.coroutines.delay

private const val HIDE_CONTROLS_MS = 3000L

fun formatTime(sec: Double): String {
    val total = if (sec.isFinite() && sec > 0) sec.toLong() else 0L
    val h = total / 3600
    val m = (total / 60) % 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** Video surface + custom controls + sync status. All controls go through the sync engine. */
@Composable
fun PlayerPane(
    vm: RoomViewModel,
    fullscreen: Boolean,
    onToggleFullscreen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsState()
    val presence by vm.presence.collectAsState()
    val selfBuffering by vm.selfBuffering.collectAsState()
    val qualities by vm.qualities.collectAsState()
    val selectedQuality by vm.selectedQuality.collectAsState()
    val playerError by vm.playerError.collectAsState()

    var showControls by remember { mutableStateOf(true) }
    var poke by remember { mutableIntStateOf(0) }
    var positionMs by remember { mutableLongStateOf(0L) }
    var durationMs by remember { mutableLongStateOf(0L) }
    var bufferedMs by remember { mutableLongStateOf(0L) }
    var activeHeight by remember { mutableIntStateOf(0) }
    var scrub by remember { mutableStateOf<Float?>(null) }

    // Poll the player for the progress UI.
    LaunchedEffect(vm.player) {
        while (true) {
            positionMs = vm.player.currentPosition
            durationMs = vm.player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0L
            bufferedMs = vm.player.bufferedPosition
            activeHeight = vm.player.videoFormat?.height ?: 0
            delay(250)
        }
    }
    // Auto-hide while playing.
    val roomPlaying = state?.playing == true
    LaunchedEffect(showControls, poke, roomPlaying, scrub) {
        if (showControls && roomPlaying && scrub == null) {
            delay(HIDE_CONTROLS_MS)
            showControls = false
        }
    }

    Box(
        modifier
            .background(Color.Black)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                showControls = !showControls; poke++
            }
            .testTag("player"),
    ) {
        ContentFrame(
            player = vm.player,
            modifier = Modifier.fillMaxSize(),
            surfaceType = SURFACE_TYPE_TEXTURE_VIEW,
            contentScale = ContentScale.Fit,
        )

        playerError?.let {
            Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
                Text(it, color = WpColors.Error, fontSize = 14.sp, modifier = Modifier.padding(16.dp))
            }
        }

        SyncStatusPill(state, presence, vm.user.uid, selfBuffering, Modifier.align(Alignment.TopCenter).padding(top = 10.dp))

        AnimatedVisibility(showControls, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.fillMaxSize()) {
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(0f to Color(0x66000000), 0.5f to Color(0x22000000), 1f to Color(0xCC000000)),
                ),
            ) {
                // Center: -10s, play/pause, +10s
                Row(
                    Modifier.align(Alignment.Center),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(28.dp),
                ) {
                    IconButton(onClick = { vm.seekBy(-10.0); poke++ }, modifier = Modifier.testTag("back10")) {
                        Icon(Icons.Filled.Replay10, "Back 10 seconds", tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                    IconButton(
                        onClick = { vm.togglePlay(); poke++ },
                        modifier = Modifier.size(64.dp).background(Color(0x55000000), CircleShape).testTag("playPause"),
                    ) {
                        Icon(
                            if (roomPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                            if (roomPlaying) "Pause" else "Play",
                            tint = Color.White,
                            modifier = Modifier.size(40.dp),
                        )
                    }
                    IconButton(onClick = { vm.seekBy(10.0); poke++ }, modifier = Modifier.testTag("fwd10")) {
                        Icon(Icons.Filled.Forward10, "Forward 10 seconds", tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                }

                // Bottom: seek bar, time, quality, fullscreen
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
                    val duration = durationMs / 1000f
                    Slider(
                        value = (scrub ?: (positionMs / 1000f)).coerceIn(0f, duration.coerceAtLeast(0.001f)),
                        onValueChange = { scrub = it; poke++ },
                        onValueChangeFinished = {
                            scrub?.let { vm.seekTo(it.toDouble()) }
                            scrub = null
                        },
                        valueRange = 0f..duration.coerceAtLeast(0.001f),
                        colors = SliderDefaults.colors(
                            thumbColor = WpColors.Accent,
                            activeTrackColor = WpColors.Accent,
                            inactiveTrackColor = Color(0x44FFFFFF),
                        ),
                        modifier = Modifier.fillMaxWidth().testTag("seekBar"),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${formatTime((scrub?.toDouble() ?: (positionMs / 1000.0)))} / ${formatTime(durationMs / 1000.0)}",
                            color = Color(0xFFE4E4E7), fontSize = 12.sp,
                        )
                        Box(Modifier.weight(1f))
                        QualityButton(qualities, selectedQuality, activeHeight, onSelect = { vm.selectQuality(it); poke++ })
                        IconButton(onClick = onToggleFullscreen, modifier = Modifier.testTag("fullscreen")) {
                            Icon(
                                if (fullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                                if (fullscreen) "Exit fullscreen" else "Fullscreen",
                                tint = Color.White,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QualityButton(
    options: List<QualityOption>,
    selected: Int?,
    activeHeight: Int,
    onSelect: (QualityOption?) -> Unit,
) {
    if (options.size < 2) return
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }, modifier = Modifier.testTag("quality")) {
            Text(
                if (selected == null) "Auto" + (if (activeHeight > 0) " (${activeHeight}p)" else "") else "${selected}p",
                color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Medium,
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("Auto" + if (selected == null) "  ✓" else "") },
                onClick = { onSelect(null); open = false },
            )
            options.forEach { o ->
                DropdownMenuItem(
                    text = { Text("${o.height}p" + if (selected == o.height) "  ✓" else "") },
                    onClick = { onSelect(o); open = false },
                )
            }
        }
    }
}

/** "Bob is buffering…" / "Buffering…" / "Bob paused at 2:21". Mirrors web SyncStatus. */
@Composable
private fun SyncStatusPill(
    state: PlaybackState?,
    presence: Map<String, Presence>,
    selfUid: String,
    selfBuffering: Boolean,
    modifier: Modifier,
) {
    var toast by remember { mutableStateOf<String?>(null) }
    var last by remember { mutableStateOf<PlaybackState?>(null) }
    var toastSeq by remember { mutableIntStateOf(0) }

    LaunchedEffect(state) {
        val prev = last
        last = state
        if (state == null || prev == null || state.rev == prev.rev || state.by == selfUid) return@LaunchedEffect
        val who = presence[state.by]?.name ?: "Someone"
        val verb = when {
            state.playing == prev.playing -> "jumped to"
            state.playing -> "played at"
            else -> "paused at"
        }
        toast = "$who $verb ${formatTime(state.position)}"
        toastSeq++
    }
    LaunchedEffect(toastSeq) {
        if (toast != null) {
            delay(2500)
            toast = null
        }
    }

    val waitingFor = presence.filter { (uid, p) -> uid != selfUid && p.online && p.buffering }.values.map { it.name }
    val (text, warn) = when {
        waitingFor.isNotEmpty() -> "${names(waitingFor)} ${if (waitingFor.size == 1) "is" else "are"} buffering…" to true
        selfBuffering -> "Buffering…" to false
        toast != null -> toast!! to false
        else -> return
    }
    Box(
        modifier
            .background(if (warn) Color(0xE6F59E0B) else Color(0xB3000000), RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 5.dp)
            .testTag("syncStatus"),
    ) {
        Text(text, color = if (warn) Color.Black else Color(0xFFF4F4F5), fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

private fun names(n: List<String>) = if (n.size <= 2) n.joinToString(" and ") else "${n.take(2).joinToString(", ")} and ${n.size - 2} more"
