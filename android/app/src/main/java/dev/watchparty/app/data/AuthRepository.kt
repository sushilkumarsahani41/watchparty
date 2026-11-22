package dev.watchparty.app.data

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.UserProfileChangeRequest
import com.google.firebase.database.MutableData
import com.google.firebase.database.ServerValue
import com.google.firebase.database.Transaction
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DataSnapshot
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/** Immutable snapshot of the signed-in user (FirebaseUser is mutable and not observable). */
data class AppUser(val uid: String, val email: String, val displayName: String)

private fun FirebaseUser.toAppUser() = AppUser(
    uid = uid,
    email = email.orEmpty(),
    displayName = displayName?.takeIf { it.isNotBlank() } ?: email?.substringBefore('@') ?: "Guest",
)

object AuthRepository {
    private val _user = MutableStateFlow<AppUser?>(null)
    private val _ready = MutableStateFlow(false)

    /** Null while signed out. Check [ready] to tell "loading" from "signed out". */
    val user: StateFlow<AppUser?> = _user.asStateFlow()
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    private var started = false

    fun start() {
        if (started) return
        started = true
        Fb.auth.addAuthStateListener { a ->
            val u = a.currentUser
            _user.value = u?.toAppUser()
            _ready.value = true
            if (u != null) ensureProfile(u)
        }
    }

    suspend fun signIn(email: String, password: String) {
        Fb.auth.signInWithEmailAndPassword(email.trim(), password).await()
    }

    suspend fun signUp(email: String, password: String, displayName: String) {
        val cred = Fb.auth.createUserWithEmailAndPassword(email.trim(), password).await()
        val user = cred.user ?: error("Sign-up returned no user")
        val name = displayName.trim().ifBlank { email.substringBefore('@') }
        // Creating the account signs in, which swaps the login screen out and cancels the caller's
        // scope. Finish setting up the profile regardless.
        withContext(NonCancellable) {
            user.updateProfile(UserProfileChangeRequest.Builder().setDisplayName(name).build()).await()
            // updateProfile doesn't fire the auth listener; publish the new name right away.
            _user.value = user.toAppUser()
            Fb.ref(Paths.user(user.uid)).setValue(
                mapOf("email" to email.trim(), "displayName" to name, "createdAt" to ServerValue.TIMESTAMP),
            ).await()
        }
    }

    suspend fun resetPassword(email: String) {
        Fb.auth.sendPasswordResetEmail(email.trim()).await()
    }

    fun signOut() = Fb.auth.signOut()

    /** Create users/{uid} if missing; a transaction so it never clobbers a concurrent signUp write. */
    private fun ensureProfile(user: FirebaseUser) {
        val app = user.toAppUser()
        Fb.ref(Paths.user(user.uid)).runTransaction(object : Transaction.Handler {
            override fun doTransaction(current: MutableData): Transaction.Result {
                if (current.value == null) {
                    current.value = mapOf(
                        "email" to app.email,
                        "displayName" to app.displayName,
                        "createdAt" to System.currentTimeMillis(),
                    )
                }
                return Transaction.success(current)
            }

            override fun onComplete(error: DatabaseError?, committed: Boolean, snapshot: DataSnapshot?) = Unit
        }, false)
    }

    /** Short human messages for Firebase auth errors (matches the web wording). */
    fun errorMessage(e: Throwable): String = when (e) {
        is FirebaseNetworkException -> "Network error. Check your connection."
        is FirebaseTooManyRequestsException -> "Too many attempts. Wait a minute and try again."
        is FirebaseAuthException -> when (e.errorCode) {
            "ERROR_INVALID_EMAIL" -> "That email address doesn't look right."
            "ERROR_INVALID_CREDENTIAL", "ERROR_WRONG_PASSWORD", "ERROR_USER_NOT_FOUND" ->
                "Email or password is incorrect."
            "ERROR_EMAIL_ALREADY_IN_USE" -> "An account with this email already exists. Try logging in."
            "ERROR_WEAK_PASSWORD" -> "Password must be at least 6 characters."
            else -> e.message ?: "Something went wrong."
        }
        else -> e.message ?: "Something went wrong."
    }
}
