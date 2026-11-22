package dev.watchparty.app.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.watchparty.app.data.AppUser
import dev.watchparty.app.data.AuthRepository
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
    var creating by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(user.uid) {
        RoomRepository.userRoomIds(user.uid)
            .catch { rooms = emptyList() }
            .collect { ids -> rooms = RoomRepository.loadMetas(ids) }
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Wordmark()
            Spacer(Modifier.weight(1f))
            Text(user.displayName, color = WpColors.Muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = 8.dp).weight(1f, fill = false))
            OutlinedButton(onClick = { AuthRepository.signOut() }, shape = RoundedCornerShape(10.dp)) { Text("Sign out") }
        }

        Spacer(Modifier.padding(top = 20.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = joinInput,
                onValueChange = { joinInput = it; joinError = null },
                placeholder = { Text("Paste invite link or room code") },
                singleLine = true,
                modifier = Modifier.weight(1f).testTag("joinInput"),
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = {
                    val id = RoomRepository.parseRoomInput(joinInput)
                    if (id == null) joinError = "Paste an invite link like …/room/abc123 or a room code." else onOpenRoom(id)
                },
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.testTag("join"),
            ) { Text("Join") }
        }
        joinError?.let { Text(it, color = WpColors.Error, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }

        Row(Modifier.padding(top = 24.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Your rooms", fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            OutlinedButton(
                onClick = {
                    creating = true; createError = null
                    scope.launch {
                        try {
                            onOpenRoom(RoomRepository.createTestRoom(user.uid))
                        } catch (e: Exception) {
                            createError = e.message ?: "Couldn't create the room."
                        } finally {
                            creating = false
                        }
                    }
                },
                enabled = !creating,
                shape = RoundedCornerShape(10.dp),
            ) { Text(if (creating) "Creating…" else "+ Test room") }
        }
        createError?.let { Text(it, color = WpColors.Error, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp)) }

        val list = rooms
        when {
            list == null -> Text("Loading…", color = WpColors.Faint, fontSize = 14.sp)
            list.isEmpty() -> Box(
                Modifier.fillMaxWidth().border(1.dp, WpColors.SurfaceHigh, RoundedCornerShape(16.dp)).padding(28.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "No rooms yet. Open an invite link from a friend, or upload a video with the desktop app.",
                    color = WpColors.Muted, fontSize = 14.sp,
                )
            }
            else -> LazyColumn(
                Modifier.fillMaxWidth().border(1.dp, WpColors.SurfaceHigh, RoundedCornerShape(16.dp)),
                verticalArrangement = Arrangement.Top,
            ) {
                items(list, key = { it.first }) { (id, meta) ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onOpenRoom(id) }.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(meta.title, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                (if (meta.hostUid == user.uid) "Hosted by you" else "Joined") +
                                    (if (meta.createdAt > 0) " · " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(meta.createdAt)) else ""),
                                color = WpColors.Faint, fontSize = 12.sp,
                            )
                        }
                        Text("→", color = WpColors.Faint)
                    }
                    HorizontalDivider(color = WpColors.SurfaceHigh)
                }
            }
        }
    }
}
