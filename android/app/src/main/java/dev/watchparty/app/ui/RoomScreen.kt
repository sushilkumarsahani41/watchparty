package dev.watchparty.app.ui

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.watchparty.app.data.CHAT_MAX_LENGTH
import dev.watchparty.app.data.ChatMessage
import dev.watchparty.app.data.Presence
import dev.watchparty.app.data.RoomRepository
import java.text.DateFormat
import java.util.Date

@Composable
fun RoomScreen(vm: RoomViewModel, onBack: () -> Unit) {
    val status by vm.status.collectAsState()
    when (val s = status) {
        RoomStatus.Joining -> FullScreenMessage("Joining room…")
        RoomStatus.NotFound -> FullScreenMessage("Room not found", "This invite link is wrong or the room was deleted.")
        is RoomStatus.Error -> FullScreenMessage("Couldn't open this room", s.message)
        is RoomStatus.Ready -> RoomContent(vm, s.meta.title, onBack)
    }
}

@Composable
private fun RoomContent(vm: RoomViewModel, title: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val activity = context as? Activity
    val view = LocalView.current
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val state by vm.state.collectAsState()
    val presence by vm.presence.collectAsState()
    val messages by vm.messages.collectAsState()
    val connected by vm.connected.collectAsState()

    // Foreground/background -> presence + local playback.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> vm.setForeground(true)
                Lifecycle.Event.ON_STOP -> vm.setForeground(false)
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }

    // Keep the screen on while the room is playing.
    DisposableEffect(state?.playing) {
        view.keepScreenOn = state?.playing == true
        onDispose { view.keepScreenOn = false }
    }

    // Landscape = fullscreen: hide system bars.
    DisposableEffect(landscape) {
        val window = activity?.window
        if (window != null) {
            val ctl = WindowCompat.getInsetsController(window, view)
            if (landscape) {
                ctl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                ctl.hide(WindowInsetsCompat.Type.systemBars())
            } else {
                ctl.show(WindowInsetsCompat.Type.systemBars())
            }
        }
        onDispose {}
    }
    // Leaving the room: give orientation back to the system.
    DisposableEffect(Unit) {
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            activity?.window?.let { WindowCompat.getInsetsController(it, view).show(WindowInsetsCompat.Type.systemBars()) }
        }
    }

    val toggleFullscreen = {
        activity?.requestedOrientation =
            if (landscape) ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
    BackHandler(enabled = landscape) { toggleFullscreen() }

    if (landscape) {
        PlayerPane(vm, fullscreen = true, onToggleFullscreen = toggleFullscreen, modifier = Modifier.fillMaxSize())
        return
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(title, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (!connected) Text("Reconnecting…", color = WpColors.Buffering, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 6.dp))
            IconButton(onClick = {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "Watch \"$title\" with me: ${RoomRepository.inviteLink(vm.roomId)}")
                }
                context.startActivity(Intent.createChooser(send, "Share invite link"))
            }, modifier = Modifier.testTag("share")) { Icon(Icons.Filled.Share, "Share invite link") }
        }
        PlayerPane(vm, fullscreen = false, onToggleFullscreen = toggleFullscreen, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f))
        Participants(presence, vm.user.uid)
        Chat(messages, vm.user.uid, onSend = { text, onFailed -> vm.sendChat(text, onFailed) }, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun Participants(presence: Map<String, Presence>, selfUid: String) {
    val people = presence.entries.sortedWith(
        compareBy<Map.Entry<String, Presence>>({ !it.value.online }, { it.key != selfUid }, { it.value.name.lowercase() }),
    )
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text(
            "WATCHING · ${people.count { it.value.online }} ONLINE",
            color = WpColors.Faint, fontSize = 11.sp, fontWeight = FontWeight.Medium,
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
            items(people, key = { it.key }) { (uid, p) ->
                Row(
                    Modifier.border(1.dp, WpColors.SurfaceHigh, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(8.dp).background(
                            when {
                                !p.online -> Color(0xFF52525B)
                                p.buffering -> WpColors.Buffering
                                else -> WpColors.Online
                            },
                            CircleShape,
                        ),
                    )
                    Text(
                        p.name + if (uid == selfUid) " (you)" else "",
                        color = if (p.online) Color(0xFFE4E4E7) else WpColors.Faint,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun Chat(
    messages: List<ChatMessage>,
    selfUid: String,
    onSend: (String, () -> Unit) -> Unit,
    modifier: Modifier,
) {
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val timeFmt = remember { DateFormat.getTimeInstance(DateFormat.SHORT) }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    Column(modifier.fillMaxWidth().background(WpColors.Background)) {
        Box(Modifier.fillMaxWidth().padding(top = 2.dp).background(WpColors.SurfaceHigh).padding(top = 1.dp))
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 10.dp),
        ) {
            if (messages.isEmpty()) {
                item { Text("No messages yet. Say hi 👋", color = WpColors.Faint, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(24.dp)) }
            }
            items(messages, key = { it.id }) { m ->
                val mine = m.uid == selfUid
                Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                    Row {
                        if (!mine) Text(m.name, color = WpColors.Muted, fontSize = 11.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(end = 6.dp))
                        m.ts?.let { Text(timeFmt.format(Date(it)), color = WpColors.Faint, fontSize = 11.sp) }
                    }
                    Text(
                        m.text,
                        color = if (mine) Color.White else Color(0xFFF4F4F5),
                        fontSize = 14.sp,
                        modifier = Modifier
                            .padding(top = 2.dp)
                            .widthIn(max = 300.dp)
                            .background(
                                if (mine) WpColors.AccentStrong else WpColors.SurfaceHigh,
                                RoundedCornerShape(16.dp, 16.dp, if (mine) 4.dp else 16.dp, if (mine) 16.dp else 4.dp),
                            )
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
            }
        }
        error?.let { Text(it, color = WpColors.Error, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 12.dp)) }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it.take(CHAT_MAX_LENGTH) },
                placeholder = { Text("Message") },
                shape = RoundedCornerShape(50),
                maxLines = 4,
                modifier = Modifier.weight(1f).testTag("chatInput"),
            )
            Spacer(Modifier.size(6.dp))
            IconButton(
                onClick = {
                    val body = text
                    text = ""
                    error = null
                    onSend(body) {
                        text = body
                        error = "Message not sent. Check your connection and try again."
                    }
                },
                enabled = text.isNotBlank(),
                modifier = Modifier.testTag("send"),
            ) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = if (text.isNotBlank()) WpColors.Accent else WpColors.Faint) }
        }
    }
}
