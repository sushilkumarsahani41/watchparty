package dev.watchparty.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Matches the web app's palette (web/src/app/globals.css). */
object WpColors {
    val Background = Color(0xFF17151F)
    val Surface = Color(0xFF1F1C29)
    val SurfaceHigh = Color(0xFF2A2636)
    val Accent = Color(0xFFA88BFA)
    val AccentStrong = Color(0xFF8B6CF0)
    val Muted = Color(0xFFA1A1AA)
    val Faint = Color(0xFF71717A)
    val Online = Color(0xFF34D399)
    val Buffering = Color(0xFFFBBF24)
    val Error = Color(0xFFFCA5A5)
    val Success = Color(0xFF6EE7B7)
}

private val scheme = darkColorScheme(
    primary = WpColors.AccentStrong,
    onPrimary = Color.White,
    secondary = WpColors.Accent,
    background = WpColors.Background,
    onBackground = Color(0xFFF4F4F5),
    surface = WpColors.Surface,
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = WpColors.SurfaceHigh,
    onSurfaceVariant = WpColors.Muted,
    surfaceContainer = WpColors.Surface,
    surfaceContainerHigh = WpColors.SurfaceHigh,
    outline = Color(0x1FFFFFFF),
    outlineVariant = Color(0x14FFFFFF),
    error = WpColors.Error,
)

@Composable
fun WatchPartyTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, content = content)

@Composable
fun Wordmark(size: Int = 22) {
    Text(
        buildAnnotatedString {
            append("Watch")
            withStyle(SpanStyle(color = WpColors.Accent)) { append("Party") }
        },
        fontSize = size.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
fun FullScreenMessage(title: String, body: String? = null) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
            if (body != null) {
                Text(body, color = WpColors.Muted, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}
