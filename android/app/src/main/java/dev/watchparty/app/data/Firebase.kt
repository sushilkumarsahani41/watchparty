package dev.watchparty.app.data

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.Query
import com.google.firebase.database.ValueEventListener
import dev.watchparty.app.BuildConfig
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** Single place that owns Firebase instances (and emulator wiring for local testing). */
object Fb {
    private const val EMULATOR_HOST = "10.0.2.2"

    val auth: FirebaseAuth by lazy {
        FirebaseAuth.getInstance().also {
            if (BuildConfig.USE_EMULATORS) it.useEmulator(EMULATOR_HOST, 9099)
        }
    }

    val db: FirebaseDatabase by lazy {
        FirebaseDatabase.getInstance().also {
            if (BuildConfig.USE_EMULATORS) it.useEmulator(EMULATOR_HOST, 9000)
        }
    }

    fun ref(path: String) = db.getReference(path)
}

/** Live snapshots of a query as a Flow; errors close the flow with an exception. */
fun Query.snapshots(): Flow<DataSnapshot> = callbackFlow {
    val listener = object : ValueEventListener {
        override fun onDataChange(snapshot: DataSnapshot) {
            trySend(snapshot)
        }

        override fun onCancelled(error: DatabaseError) {
            Log.w("WatchParty", "listener cancelled at $this: ${error.message}")
            close(error.toException())
        }
    }
    addValueEventListener(listener)
    awaitClose { removeEventListener(listener) }
}
