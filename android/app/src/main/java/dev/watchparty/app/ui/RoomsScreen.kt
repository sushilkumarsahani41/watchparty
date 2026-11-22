package dev.watchparty.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.SmartDisplay
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.watchparty.app.data.AppUser
import dev.watchparty.app.data.AuthRepository
import dev.watchparty.app.data.RoomInput
import dev.watchparty.app.data.RoomMeta
import dev.watchparty.app.data.RoomRepository
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun RoomsScreen(user: AppUser, onOpenRoom: (String) -> Unit) {
    var rooms by remember { mutableStateOf<List<Pair<String, RoomMeta>>?>(null) }
    var joinInput by remember { mutableStateOf("") }
    var joinError by remember { mutableStateOf<String?>(null) }
    var ytInput by remember { mutableStateOf("") }
    var ytError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Pair<String, RoomMeta>?>(null) }
    var listError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(user.uid) {
        RoomRepository.userRoomIds(user.uid)
            .catch { rooms = emptyList() }
            .collect { ids -> rooms = RoomRepository.loadMetas(ids) }
    }

    fun join() {
        val id = RoomRepository.parseRoomInput(joinInput)
        if (id == null) joinError = "Enter an 8-character room code like ABCD-2345, or paste an invite link." else onOpenRoom(id)
    }

    fun create(kind: String, block: suspend () -> String) {
        busy = kind
        ytError = null
        scope.launch {
            try {
                onOpenRoom(block())
            } catch (e: Exception) {
                ytError = e.message ?: "Couldn't create the room."
            } finally {
                busy = null
            }
        }
    }

    val firstName = user.displayName.substringBefore(' ')

    LazyColumn(
        Modifier.fillMaxSize().safeDrawingPadding(),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 14.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Wordmark()
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier.size(32.dp).clip(CircleShape).background(WpColors.SurfaceHigh).border(1.dp, WpColors.LineStrong, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text(user.displayName.take(1).uppercase(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
                IconButton(onClick = { AuthRepository.signOut() }) {
                    Icon(Icons.AutoMirrored.Filled.Logout, "Sign out", tint = WpColors.Muted, modifier = Modifier.size(20.dp))
                }
            }

            Text("Hey $firstName 👋", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.6).sp, modifier = Modifier.padding(top = 26.dp))
            Text("Join a room with its code, or start a new watch party.", color = WpColors.Muted, fontSize = 15.sp, modifier = Modifier.padding(top = 4.dp))

            // Join
            Column(Modifier.padding(top = 22.dp).fillMaxWidth().wpCard().padding(18.dp)) {
                Text("Join a room", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text("Room code or invite link", color = WpColors.Faint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp, bottom = 12.dp))
                WpTextField(
                    value = joinInput,
                    onValueChange = { joinInput = it; joinError = null },
                    placeholder = "ABCD-2345",
                    textStyle = TextStyle(fontSize = 17.sp, fontFamily = FontFamily.Monospace, letterSpacing = 2.5.sp, fontWeight = FontWeight.SemiBold),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, imeAction = ImeAction.Go),
                    modifier = Modifier.fillMaxWidth().testTag("joinInput"),
                )
                joinError?.let { Text(it, color = WpColors.Error, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                PrimaryButton("Join  →", onClick = ::join, modifier = Modifier.padding(top = 12.dp).fillMaxWidth(), tag = "join")
            }

            // YouTube
            Column(Modifier.padding(top = 12.dp).fillMaxWidth().wpCard().padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.SmartDisplay, null, tint = WpColors.YouTube, modifier = Modifier.size(20.dp))
                    Text("YouTube party", fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.padding(start = 8.dp))
                }
                Text("Watch any YouTube video together", color = WpColors.Faint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp, bottom = 12.dp))
                WpTextField(
                    value = ytInput,
                    onValueChange = { ytInput = it; ytError = null },
                    placeholder = "https://youtu.be/…",
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth().testTag("youtubeInput"),
                )
                ytError?.let { Text(it, color = WpColors.Error, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                SecondaryButton(
                    if (busy == "yt") "Creating…" else "Create room",
                    onClick = {
                        val id = RoomInput.parseYouTubeId(ytInput)
                        if (id == null) ytError = "Paste a YouTube link, like https://youtu.be/… or youtube.com/watch?v=…"
                        else create("yt") { RoomRepository.createYouTubeRoom(user.uid, id) }
                    },
                    enabled = busy == null,
                    modifier = Modifier.padding(top = 12.dp).fillMaxWidth(),
                    tag = "createYoutube",
                )
            }

            Text(
                if (busy == "test") "Creating demo room…" else "Just exploring? Open a demo room",
                color = WpColors.Muted, fontSize = 13.sp,
                modifier = Modifier
                    .padding(top = 6.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(enabled = busy == null) { create("test") { RoomRepository.createTestRoom(user.uid) } }
                    .padding(vertical = 10.dp)
                    .testTag("demoRoom"),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )

            Row(Modifier.padding(top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.Bottom) {
                Text("Your rooms", fontWeight = FontWeight.SemiBold, fontSize = 18.sp, modifier = Modifier.weight(1f))
                rooms?.takeIf { it.isNotEmpty() }?.let { Text("${it.size}", color = WpColors.Faint, fontSize = 13.sp) }
            }
            listError?.let { Text(it, color = WpColors.Error, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp)) }
        }

        val list = rooms
        when {
            list == null -> item { Text("Loading…", color = WpColors.Faint, fontSize = 14.sp) }
            list.isEmpty() -> item {
                Box(
                    Modifier.fillMaxWidth().border(1.dp, WpColors.LineStrong, RoundedCornerShape(20.dp)).padding(28.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("No rooms yet. Join one with a code, or start a YouTube party above.", color = WpColors.Muted, fontSize = 14.sp)
                }
            }
            else -> items(list, key = { it.first }) { (id, meta) ->
                val first = id == list.first().first
                val last = id == list.last().first
                val shape = RoundedCornerShape(
                    topStart = if (first) 20.dp else 0.dp, topEnd = if (first) 20.dp else 0.dp,
                    bottomStart = if (last) 20.dp else 0.dp, bottomEnd = if (last) 20.dp else 0.dp,
                )
                Column(Modifier.clip(shape).background(WpColors.Surface)) {
                    RoomRow(id, meta, isHost = meta.hostUid == user.uid, onOpen = { onOpenRoom(id) }, onDelete = { deleting = id to meta })
                    if (!last) HorizontalDivider(color = WpColors.Line)
                }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }

    deleting?.let { (id, meta) ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = WpColors.Surface2,
            title = { Text("Delete this room?") },
            text = {
                Text(
                    "\"${meta.title}\" will be removed for everyone, with its chat." +
                        if (!meta.isYouTube && meta.videoId != "test-bbb") " The uploaded video stays on R2 until you delete it in the uploader's My uploads." else "",
                    color = WpColors.Muted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    scope.launch {
                        try {
                            RoomRepository.deleteRoom(id, user.uid)
                            rooms = rooms?.filterNot { it.first == id }
                        } catch (e: Exception) {
                            listError = e.message ?: "Couldn't delete the room."
                        }
                    }
                }, modifier = Modifier.testTag("confirmDelete")) { Text("Delete", color = WpColors.Error) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel", color = WpColors.Muted) } },
        )
    }
}

@Composable
private fun RoomRow(id: String, meta: RoomMeta, isHost: Boolean, onOpen: () -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(start = 14.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(WpColors.SurfaceHigh), contentAlignment = Alignment.Center) {
            Icon(
                if (meta.isYouTube) Icons.Filled.SmartDisplay else Icons.Filled.Movie, null,
                tint = if (meta.isYouTube) WpColors.YouTube else WpColors.Accent, modifier = Modifier.size(20.dp),
            )
        }
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(meta.title, fontWeight = FontWeight.Medium, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 3.dp)) {
                Text(
                    RoomInput.format(id),
                    color = WpColors.Accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, letterSpacing = 1.sp,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(WpColors.AccentSoft).padding(horizontal = 7.dp, vertical = 1.dp),
                )
                Text(
                    (if (isHost) "  Hosted by you" else "  Joined") +
                        (if (meta.createdAt > 0) " · " + DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(meta.createdAt)) else ""),
                    color = WpColors.Faint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (isHost) {
            IconButton(onClick = onDelete, modifier = Modifier.testTag("delete-$id")) {
                Icon(Icons.Filled.DeleteOutline, "Delete room", tint = WpColors.Faint, modifier = Modifier.size(20.dp))
            }
        } else {
            Spacer(Modifier.width(12.dp))
        }
    }
}
