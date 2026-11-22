package dev.watchparty.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.watchparty.app.data.AppUser
import dev.watchparty.app.data.AuthRepository
import dev.watchparty.app.data.RoomRepository
import dev.watchparty.app.ui.FullScreenMessage
import dev.watchparty.app.ui.LoginScreen
import dev.watchparty.app.ui.RoomScreen
import dev.watchparty.app.ui.RoomViewModel
import dev.watchparty.app.ui.RoomsScreen
import dev.watchparty.app.ui.WatchPartyTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class MainActivity : ComponentActivity() {
    /** Room id from an invite link, consumed once the user is signed in. */
    private val pendingRoom = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Dark app: light status/navigation bar icons.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        AuthRepository.start()
        if (savedInstanceState == null) handleIntent(intent)

        setContent {
            WatchPartyTheme {
                // testTagsAsResourceId lets UI Automator (adb tests) find controls by their test tags.
                // Surface sets the default content color (light text) for everything inside.
                Surface(
                    color = MaterialTheme.colorScheme.background,
                    contentColor = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.fillMaxSize().semantics { testTagsAsResourceId = true },
                ) {
                    App(pendingRoom.asStateFlow().collectAsState().value, onPendingConsumed = { pendingRoom.value = null })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        RoomRepository.parseRoomInput(uri.toString())?.let { pendingRoom.value = it }
    }
}

@Composable
private fun App(pendingRoom: String?, onPendingConsumed: () -> Unit) {
    val ready by AuthRepository.ready.collectAsState()
    val user by AuthRepository.user.collectAsState()

    when {
        !ready -> FullScreenMessage("Loading…")
        user == null -> LoginScreen()
        else -> SignedIn(user!!, pendingRoom, onPendingConsumed)
    }
}

@Composable
private fun SignedIn(user: AppUser, pendingRoom: String?, onPendingConsumed: () -> Unit) {
    val nav = rememberNavController()

    LaunchedEffect(pendingRoom) {
        if (pendingRoom != null) {
            nav.navigate("room/$pendingRoom") { launchSingleTop = true }
            onPendingConsumed()
        }
    }

    NavHost(nav, startDestination = "rooms") {
        composable("rooms") {
            RoomsScreen(user, onOpenRoom = { id -> nav.navigate("room/$id") { launchSingleTop = true } })
        }
        composable("room/{roomId}", arguments = listOf(navArgument("roomId") { type = NavType.StringType })) { entry ->
            val roomId = entry.arguments?.getString("roomId").orEmpty()
            // Scoped to this back-stack entry: survives rotation, released when leaving the room.
            val vm: RoomViewModel = viewModel(key = "room-$roomId") {
                RoomViewModel(this[APPLICATION_KEY]!!, roomId, user)
            }
            RoomScreen(vm, onBack = {
                if (!nav.popBackStack("rooms", inclusive = false)) nav.navigate("rooms")
            })
        }
    }
}
