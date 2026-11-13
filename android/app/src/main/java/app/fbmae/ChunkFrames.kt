package app.fbmae

import java.nio.ByteBuffer
import java.nio.ByteOrder

data class ChunkFrame(val requestId: Int, val writerId: Int, val payloadOffset: Int)

/** Binary write frames from JS: [u32 LE requestId][u32 LE writerId][payload]. */
object ChunkFrames {
    fun parse(bytes: ByteArray): ChunkFrame? {
        if (bytes.size < 8) return null
        val header = ByteBuffer.wrap(bytes, 0, 8).order(ByteOrder.LITTLE_ENDIAN)
        return ChunkFrame(header.int, header.int, 8)
    }
}
