package dev.watchparty.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
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

/** Design tokens: keep in sync with web/src/app/globals.css and desktop/src/renderer/styles.css. */
object WpColors {
    val Background = Color(0xFF0C0B11)
    val Surface = Color(0xFF15141C)
    val Surface2 = Color(0xFF1C1A25)
    val SurfaceHigh = Color(0xFF252231)
    val Line = Color(0x12FFFFFF)
    val LineStrong = Color(0x1FFFFFFF)
    val Text = Color(0xFFF4F3F8)
    val Accent = Color(0xFFA78BFA)
    val AccentStrong = Color(0xFF8B5CF6)
    val AccentSoft = Color(0x248B5CF6)
    val Muted = Color(0xFFA7A4B4)
    val Faint = Color(0xFF6F6C7D)
    val YouTube = Color(0xFFF87171)
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
    onBackground = WpColors.Text,
    surface = WpColors.Surface,
    onSurface = WpColors.Text,
    surfaceVariant = WpColors.SurfaceHigh,
    onSurfaceVariant = WpColors.Muted,
    surfaceContainer = WpColors.Surface,
    surfaceContainerHigh = WpColors.Surface2,
    surfaceContainerHighest = WpColors.SurfaceHigh,
    outline = WpColors.LineStrong,
    outlineVariant = WpColors.Line,
    error = WpColors.Error,
)

@Composable
fun WatchPartyTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, content = content)

@Composable
fun LogoMark(size: Int = 28) {
    Box(
        Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size * 0.32f).dp))
            .background(Brush.linearGradient(listOf(Color(0xFFA78BFA), Color(0xFF7C3AED)))),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size((size * 0.62f).dp))
    }
}

@Composable
fun Wordmark(size: Int = 18) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        LogoMark((size * 1.6f).toInt())
        Spacer(Modifier.width(10.dp))
        Text(
            buildAnnotatedString {
                append("Watch")
                withStyle(SpanStyle(color = WpColors.Accent)) { append("Party") }
            },
            fontSize = size.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-0.2).sp,
        )
    }
}

/** Primary action: violet gradient pill-ish button. */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, tag: String? = null) {
    Box(
        modifier
            .height(48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (enabled) Brush.verticalGradient(listOf(Color(0xFF9B74FB), Color(0xFF7C4FF0)))
                else Brush.verticalGradient(listOf(WpColors.SurfaceHigh, WpColors.SurfaceHigh)),
            )
            .clickable(enabled = enabled, onClick = onClick)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (enabled) Color.White else WpColors.Faint, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/** Secondary action: outlined surface button. */
@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, tag: String? = null) {
    Box(
        modifier
            .height(48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(WpColors.Surface2)
            .border(1.dp, WpColors.LineStrong, RoundedCornerShape(14.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .then(if (tag != null) Modifier.testTag(tag) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (enabled) WpColors.Text else WpColors.Faint, fontWeight = FontWeight.Medium, fontSize = 15.sp)
    }
}

/** Text field in the app's style (rounded, dark fill, violet focus). */
@Composable
fun WpTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    singleLine: Boolean = true,
    textStyle: TextStyle = TextStyle(fontSize = 15.sp),
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    shape: Shape = RoundedCornerShape(14.dp),
    maxLines: Int = 1,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = WpColors.Faint, style = textStyle) },
        label = label?.let { { Text(it) } },
        singleLine = singleLine,
        maxLines = if (singleLine) 1 else maxLines,
        textStyle = textStyle,
        keyboardOptions = keyboardOptions,
        visualTransformation = visualTransformation,
        shape = shape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = WpColors.Accent,
            unfocusedBorderColor = WpColors.LineStrong,
            focusedContainerColor = Color(0x40000000),
            unfocusedContainerColor = Color(0x40000000),
            cursorColor = WpColors.Accent,
            focusedLabelColor = WpColors.Accent,
            unfocusedLabelColor = WpColors.Muted,
        ),
        modifier = modifier,
    )
}

/** Card surface used across screens. */
fun Modifier.wpCard(radius: Int = 20) =
    this.clip(RoundedCornerShape(radius.dp)).background(WpColors.Surface).border(1.dp, WpColors.Line, RoundedCornerShape(radius.dp))

@Composable
fun FullScreenMessage(title: String, body: String? = null, action: (@Composable () -> Unit)? = null) {
    val loading = title.endsWith("…")
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (loading) {
                CircularProgressIndicator(color = WpColors.Accent, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp))
                Spacer(Modifier.height(16.dp))
            }
            Text(
                title,
                fontSize = if (loading) 14.sp else 19.sp,
                color = if (loading) WpColors.Muted else WpColors.Text,
                fontWeight = if (loading) FontWeight.Medium else FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            if (body != null) {
                Text(body, color = WpColors.Muted, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
            }
            if (action != null) {
                Spacer(Modifier.height(24.dp))
                action()
            }
        }
    }
}
