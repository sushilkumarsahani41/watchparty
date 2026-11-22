package dev.watchparty.app.sync

import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.ValueEventListener
import dev.watchparty.app.data.Fb
import dev.watchparty.app.data.Paths

/** Tracks .info/serverTimeOffset so every client agrees on "now". */
object ServerTime {
    @Volatile private var offsetMs = 0L
    private var started = false

    fun start() {
        if (started) return
        started = true
        Fb.ref(Paths.SERVER_TIME_OFFSET).addValueEventListener(object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                (snapshot.value as? Number)?.let { offsetMs = it.toLong() }
            }

            override fun onCancelled(error: DatabaseError) = Unit
        })
    }

    fun now(): Long = System.currentTimeMillis() + offsetMs
}
