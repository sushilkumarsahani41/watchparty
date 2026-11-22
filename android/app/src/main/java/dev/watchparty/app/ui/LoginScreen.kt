package dev.watchparty.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.watchparty.app.data.AuthRepository
import kotlinx.coroutines.launch

private enum class Mode { Login, Signup, Reset }

@Composable
fun LoginScreen() {
    var mode by remember { mutableStateOf(Mode.Login) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun switch(m: Mode) {
        mode = m; error = null; notice = null
    }

    fun submit() {
        if (busy) return
        busy = true; error = null; notice = null
        scope.launch {
            try {
                when (mode) {
                    Mode.Login -> AuthRepository.signIn(email, password)
                    Mode.Signup -> AuthRepository.signUp(email, password, name)
                    Mode.Reset -> {
                        AuthRepository.resetPassword(email)
                        notice = "If an account exists for that email, a reset link is on its way."
                    }
                }
            } catch (e: Exception) {
                error = AuthRepository.errorMessage(e)
            } finally {
                busy = false
            }
        }
    }

    Box(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Wordmark(22)
            Text("Watch anything together, perfectly in sync.", color = WpColors.Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 12.dp, bottom = 28.dp))

            Column(Modifier.fillMaxWidth().wpCard(22)) {
                Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(
                        when (mode) {
                            Mode.Login -> "Welcome back"
                            Mode.Signup -> "Create an account"
                            Mode.Reset -> "Reset password"
                        },
                        fontSize = 21.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (mode == Mode.Signup) {
                        WpTextField(
                            value = name, onValueChange = { name = it.take(40) },
                            label = "Display name", placeholder = "", singleLine = true,
                            modifier = Modifier.fillMaxWidth().testTag("name"),
                        )
                    }
                    WpTextField(
                        value = email, onValueChange = { email = it },
                        label = "Email", placeholder = "", singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth().testTag("email"),
                    )
                    if (mode != Mode.Reset) {
                        WpTextField(
                            value = password, onValueChange = { password = it },
                            label = "Password", placeholder = "", singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            modifier = Modifier.fillMaxWidth().testTag("password"),
                        )
                    }
                    error?.let { Text(it, color = WpColors.Error, fontSize = 14.sp) }
                    notice?.let { Text(it, color = WpColors.Success, fontSize = 14.sp) }
                    PrimaryButton(
                        if (busy) "Please wait…" else when (mode) {
                            Mode.Login -> "Log in"
                            Mode.Signup -> "Sign up"
                            Mode.Reset -> "Send reset link"
                        },
                        onClick = ::submit,
                        enabled = !busy && email.isNotBlank() && (mode == Mode.Reset || password.length >= 6),
                        modifier = Modifier.fillMaxWidth(),
                        tag = "submit",
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        if (mode == Mode.Login) {
                            TextButton(onClick = { switch(Mode.Signup) }) { Text("Create account", color = WpColors.Muted) }
                            TextButton(onClick = { switch(Mode.Reset) }) { Text("Forgot password?", color = WpColors.Muted) }
                        } else {
                            TextButton(onClick = { switch(Mode.Login) }) { Text("← Back to log in", color = WpColors.Muted) }
                        }
                    }
                }
            }
        }
    }
}
