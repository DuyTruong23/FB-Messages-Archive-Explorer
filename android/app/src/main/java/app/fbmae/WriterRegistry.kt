package app.fbmae

import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Output streams opened for JS writers, addressed by integer id. */
class WriterRegistry {
    private class Writer(val stream: OutputStream, val onClose: () -> Unit)

    private val nextId = AtomicInteger(1)
    private val writers = ConcurrentHashMap<Int, Writer>()

    fun open(stream: OutputStream, onClose: () -> Unit = {}): Int {
        val id = nextId.getAndIncrement()
        writers[id] = Writer(stream, onClose)
        return id
    }

    fun write(id: Int, bytes: ByteArray, offset: Int = 0, length: Int = bytes.size) {
        require(id).stream.write(bytes, offset, length)
    }

    fun close(id: Int) {
        val writer = writers.remove(id) ?: throw IllegalStateException("Writer $id is not open.")
        writer.stream.use { it.flush() }
        writer.onClose()
    }

    fun abort(id: Int) {
        writers.remove(id)?.stream?.close()
    }

    fun closeAll() {
        for (id in writers.keys.toList()) abort(id)
    }

    private fun require(id: Int): Writer = writers[id] ?: throw IllegalStateException("Writer $id is not open.")
}
