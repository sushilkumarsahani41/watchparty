package dev.watchparty.app.ui

import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.compose.ContentFrame
import androidx.media3.ui.compose.SURFACE_TYPE_TEXTURE_VIEW
import dev.watchparty.app.data.PlaybackState
import dev.watchparty.app.data.Presence
import dev.watchparty.app.sync.ExoSyncPlayer
import dev.watchparty.app.sync.SyncPlayer
import dev.watchparty.app.sync.YouTubeSyncPlayer
import kotlinx.coroutines.delay

private const val HIDE_CONTROLS_MS = 3000L

fun formatTime(sec: Double): String {
    val total = if (sec.isFinite() && sec > 0) sec.toLong() else 0L
    val h = total / 3600
    val m = (total / 60) % 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** Video (uploads or YouTube) + our own controls + sync status. Every control goes through the sync engine. */
@Composable
fun PlayerPane(
    vm: RoomViewModel,
    fullscreen: Boolean,
    onToggleFullscreen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val player by vm.player.collectAsState()
    val state by vm.state.collectAsState()
    val presence by vm.presence.collectAsState()
    val selfBuffering by vm.selfBuffering.collectAsState()
    val qualities by vm.qualities.collectAsState()
    val selectedQuality by vm.selectedQuality.collectAsState()
    val playerError by vm.playerError.collectAsState()

    var showControls by remember { mutableStateOf(true) }
    var poke by remember { mutableIntStateOf(0) }
    var position by remember { mutableDoubleStateOf(0.0) }
    var duration by remember { mutableDoubleStateOf(0.0) }
    var buffered by remember { mutableDoubleStateOf(0.0) }
    var activeHeight by remember { mutableIntStateOf(0) }
    var scrub by remember { mutableStateOf<Double?>(null) }
    /** -1 / +1 while the double-tap "10 s" hint is showing on that side. */
    var skipHint by remember { mutableIntStateOf(0) }
    var skipSeq by remember { mutableIntStateOf(0) }

    // Poll the player for the progress UI.
    LaunchedEffect(player) {
        val p = player ?: return@LaunchedEffect
        while (true) {
            position = p.positionSec
            duration = p.durationSec
            buffered = p.bufferedSec
            activeHeight = vm.activeHeight()
            delay(250)
        }
    }
    val roomPlaying = state?.playing == true
    // Auto-hide while playing.
    LaunchedEffect(showControls, poke, roomPlaying, scrub) {
        if (showControls && roomPlaying && scrub == null) {
            delay(HIDE_CONTROLS_MS)
            showControls = false
        }
    }
    LaunchedEffect(skipSeq) {
        if (skipSeq > 0) {
            delay(600)
            skipHint = 0
        }
    }

    Box(modifier.background(Color.Black).testTag("player")) {
        when (val p = player) {
            is ExoSyncPlayer -> ContentFrame(
                player = p.exo,
                modifier = Modifier.fillMaxSize(),
                surfaceType = SURFACE_TYPE_TEXTURE_VIEW,
                contentScale = ContentScale.Fit,
            )
            is YouTubeSyncPlayer -> AndroidView(
                factory = {
                    // The WebView lives in the ViewModel (survives rotation); move it to this new host.
                    (p.webView.parent as? ViewGroup)?.removeView(p.webView)
                    p.webView
                },
                modifier = Modifier.fillMaxSize(),
            )
            null -> Unit
        }

        // Gesture layer above the video (also keeps touches out of the YouTube frame).
        val currentVm by rememberUpdatedState(vm)
        Box(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = { showControls = !showControls; poke++ },
                        onDoubleTap = { o ->
                            val dir = if (o.x < size.width / 2f) -1 else 1
                            currentVm.seekBy(10.0 * dir)
                            skipHint = dir
                            skipSeq++
                            poke++
                        },
                    )
                },
        )

        // Double-tap feedback.
        AnimatedVisibility(
            skipHint != 0,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(if (skipHint < 0) Alignment.CenterStart else Alignment.CenterEnd).padding(horizontal = 36.dp),
        ) {
            Row(
                Modifier.background(Color(0x80000000), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (skipHint < 0) Icons.Filled.Replay10 else Icons.Filled.Forward10, null, tint = Color.White, modifier = Modifier.size(18.dp))
                Text(if (skipHint < 0) " −10s" else " +10s", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        // Loading spinner in the middle, unless the controls (with the play button there) are showing.
        if ((selfBuffering || player?.phase == SyncPlayer.Phase.Idle) && !showControls) {
            CircularProgressIndicator(
                color = Color.White.copy(alpha = 0.85f),
                strokeWidth = 2.5.dp,
                modifier = Modifier.align(Alignment.Center).size(34.dp),
            )
        }

        playerError?.let {
            Box(Modifier.fillMaxSize().background(Color(0xE6000000)), contentAlignment = Alignment.Center) {
                Text(it, color = WpColors.Error, fontSize = 14.sp, modifier = Modifier.padding(24.dp))
            }
        }

        SyncStatusPill(state, presence, vm.user.uid, selfBuffering, Modifier.align(Alignment.TopCenter).padding(top = 10.dp))

        AnimatedVisibility(showControls, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.fillMaxSize()) {
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(0f to Color(0x55000000), 0.35f to Color(0x11000000), 0.6f to Color(0x22000000), 1f to Color(0xD9000000)),
                ),
            ) {
                // Center: −10 · play/pause · +10. Sized so it never reaches the bottom bar on a portrait player.
                Row(
                    Modifier.align(Alignment.Center).padding(bottom = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(36.dp),
                ) {
                    RoundIcon(Icons.Filled.Replay10, "Back 10 seconds", size = 40, icon = 24, tag = "back10") { vm.seekBy(-10.0); poke++ }
                    RoundIcon(
                        if (roomPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        if (roomPlaying) "Pause" else "Play",
                        size = 56, icon = 30, filled = true, tag = "playPause",
                    ) { vm.togglePlay(); poke++ }
                    RoundIcon(Icons.Filled.Forward10, "Forward 10 seconds", size = 40, icon = 24, tag = "fwd10") { vm.seekBy(10.0); poke++ }
                }

                // Bottom: time · quality · fullscreen, then a thin seek bar.
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(start = 14.dp, end = 6.dp, bottom = if (fullscreen) 14.dp else 2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            formatTime(scrub ?: position),
                            color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        )
                        Text(" / ${formatTime(duration)}", color = Color.White.copy(alpha = 0.55f), fontSize = 12.sp)
                        Box(Modifier.weight(1f))
                        QualityChip(qualities, selectedQuality, activeHeight, onSelect = { vm.selectQuality(it); poke++ })
                        RoundIcon(
                            if (fullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                            if (fullscreen) "Exit fullscreen" else "Fullscreen",
                            size = 36, icon = 22, tag = "fullscreen",
                        ) { onToggleFullscreen() }
                    }
                    SeekBar(
                        position = scrub ?: position,
                        buffered = buffered,
                        duration = duration,
                        onScrub = { scrub = it; poke++ },
                        onScrubEnd = {
                            scrub?.let { vm.seekTo(it) }
                            scrub = null
                        },
                        modifier = Modifier.padding(end = 8.dp).testTag("seekBar"),
                    )
                }
            }
        }
    }
}

@Composable
private fun RoundIcon(
    image: ImageVector,
    label: String,
    size: Int,
    icon: Int,
    filled: Boolean = false,
    tag: String? = null,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .then(if (filled) Modifier.background(Color(0x59000000)).border(1.dp, Color(0x26FFFFFF), CircleShape) else Modifier)
            .clickable(onClick = onClick)
            .semantics { contentDescription = label }
            .then(if (tag != null) Modifier.testTag(tag) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Icon(image, null, tint = Color.White, modifier = Modifier.size(icon.dp))
    }
}

/** Thin seek bar: drag or tap to preview; the seek is written once, on release. */
@Composable
private fun SeekBar(
    position: Double,
    buffered: Double,
    duration: Double,
    onScrub: (Double) -> Unit,
    onScrubEnd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var dragging by remember { mutableStateOf(false) }
    val dur by rememberUpdatedState(duration)
    val scrub by rememberUpdatedState(onScrub)
    val end by rememberUpdatedState(onScrubEnd)
    BoxWithConstraints(modifier.fillMaxWidth().height(22.dp)) {
        val widthPx = with(LocalDensity.current) { maxWidth.toPx() }
        fun at(x: Float) = if (dur > 0) (x / widthPx).coerceIn(0f, 1f) * dur else 0.0
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(onTap = { o -> if (dur > 0) { scrub(at(o.x)); end() } })
                }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragStart = { o -> dragging = true; scrub(at(o.x)) },
                        onDragEnd = { dragging = false; end() },
                        onDragCancel = { dragging = false; end() },
                        onHorizontalDrag = { change, _ -> scrub(at(change.position.x)) },
                    )
                },
        ) {
            val track = (if (dragging) 5.dp else 3.dp).toPx()
            val y = size.height / 2
            val frac = { v: Double -> if (duration > 0) (v / duration).toFloat().coerceIn(0f, 1f) else 0f }
            val r = CornerRadius(track / 2)
            drawRoundRect(Color(0x40FFFFFF), Offset(0f, y - track / 2), Size(size.width, track), r)
            drawRoundRect(Color(0x40FFFFFF), Offset(0f, y - track / 2), Size(size.width * frac(buffered), track), r)
            drawRoundRect(WpColors.Accent, Offset(0f, y - track / 2), Size(size.width * frac(position), track), r)
            drawCircle(Color.White, radius = (if (dragging) 8.dp else 6.dp).toPx(), center = Offset(size.width * frac(position), y))
        }
    }
}

@Composable
private fun QualityChip(
    options: List<QualityOption>,
    selected: Int?,
    activeHeight: Int,
    onSelect: (QualityOption?) -> Unit,
) {
    if (options.size < 2) return
    var open by remember { mutableStateOf(false) }
    Box(Modifier.padding(end = 4.dp)) {
        Text(
            if (selected == null) "AUTO" + (if (activeHeight > 0) " · ${activeHeight}p" else "") else "${selected}p",
            color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp,
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .border(1.dp, Color(0x40FFFFFF), RoundedCornerShape(6.dp))
                .clickable { open = true }
                .padding(horizontal = 7.dp, vertical = 4.dp)
                .testTag("quality"),
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = RoundedCornerShape(14.dp), containerColor = WpColors.Surface2) {
            DropdownMenuItem(
                text = { Text("Auto", fontWeight = if (selected == null) FontWeight.SemiBold else FontWeight.Normal) },
                trailingIcon = { if (selected == null) Text("✓", color = WpColors.Accent) },
                onClick = { onSelect(null); open = false },
            )
            options.forEach { o ->
                DropdownMenuItem(
                    text = { Text("${o.height}p", fontWeight = if (selected == o.height) FontWeight.SemiBold else FontWeight.Normal) },
                    trailingIcon = { if (selected == o.height) Text("✓", color = WpColors.Accent) },
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
    AnimatedVisibility(true, enter = fadeIn() + scaleIn(initialScale = 0.9f), exit = fadeOut() + scaleOut(), modifier = modifier) {
        Box(
            Modifier
                .background(if (warn) Color(0xE6FBBF24) else Color(0x99000000), RoundedCornerShape(50))
                .border(1.dp, if (warn) Color(0x4DFDE68A) else Color(0x1AFFFFFF), RoundedCornerShape(50))
                .padding(horizontal = 14.dp, vertical = 6.dp)
                .testTag("syncStatus"),
        ) {
            Text(text, color = if (warn) Color.Black else Color.White, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        }
    }
}

private fun names(n: List<String>) = if (n.size <= 2) n.joinToString(" and ") else "${n.take(2).joinToString(", ")} and ${n.size - 2} more"
