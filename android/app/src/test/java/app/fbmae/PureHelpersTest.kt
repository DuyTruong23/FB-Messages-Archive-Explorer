package app.fbmae

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

class PureHelpersTest {
    private val tree = "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Ffb"

    @Test
    fun decodesBase64UrlPaths() {
        val uri = "$tree/document/primary%3ADownload%2Ffb%2FTôi.json"
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(uri.toByteArray(Charsets.UTF_8))
        assertEquals(uri, SafPath.decode(encoded))
        assertNull(SafPath.decode(""))
        assertNull(SafPath.decode("not base64 !"))
    }

    @Test
    fun allowsOnlyDocumentsUnderGrantedTrees() {
        val trees = listOf(tree)
        assertTrue(TreeGuard.isAllowed("$tree/document/primary%3ADownload%2Ffb%2Fa.json", trees))
        assertFalse(TreeGuard.isAllowed("$tree/document/", trees))
        assertFalse(TreeGuard.isAllowed("$tree/document/a/../b", trees))
        assertFalse(TreeGuard.isAllowed("content://other/tree/x/document/y", trees))
        assertFalse(TreeGuard.isAllowed("${tree}2/document/primary%3ADownload%2Ffb2", trees))
        assertTrue(TreeGuard.isTreeGranted(tree, trees))
        assertFalse(TreeGuard.isTreeGranted("$tree/x", trees))
    }

    @Test
    fun writesClosesAndAbortsStreams() {
        val registry = WriterRegistry()
        val out = ByteArrayOutputStream()
        var closed = 0
        val id = registry.open(out) { closed++ }
        registry.write(id, byteArrayOf(9, 1, 2, 3), 1, 3)
        registry.close(id)
        assertArrayEquals(byteArrayOf(1, 2, 3), out.toByteArray())
        assertEquals(1, closed)
        assertThrows(IllegalStateException::class.java) { registry.write(id, byteArrayOf(1)) }

        val aborted = registry.open(ByteArrayOutputStream()) { closed++ }
        registry.abort(aborted)
        assertEquals(1, closed)
        assertThrows(IllegalStateException::class.java) { registry.close(aborted) }
    }

    @Test
    fun mapsExceptionsToDomErrorNames() {
        assertEquals("AbortError", DomErrors.nameFor(PickerCancelledException()))
        assertEquals("NotAllowedError", DomErrors.nameFor(SecurityException()))
        assertEquals("NotFoundError", DomErrors.nameFor(FileNotFoundException()))
        assertEquals("NotReadableError", DomErrors.nameFor(IOException()))
        assertEquals("InvalidStateError", DomErrors.nameFor(IllegalStateException()))
        assertEquals("NotSupportedError", DomErrors.nameFor(IllegalArgumentException()))
        assertEquals("UnknownError", DomErrors.nameFor(RuntimeException()))
    }

    @Test
    fun parsesChunkFrames() {
        val buffer = ByteBuffer.allocate(11).order(ByteOrder.LITTLE_ENDIAN).putInt(42).putInt(7).put(byteArrayOf(1, 2, 3))
        assertEquals(ChunkFrame(42, 7, 8), ChunkFrames.parse(buffer.array()))
        assertNull(ChunkFrames.parse(ByteArray(7)))
    }

    @Test
    fun sanitizesOutputNames() {
        assertEquals("a_b_c.json", OutputNames.sanitize("a/b\\c.json"))
        assertEquals("attachment", OutputNames.sanitize("  "))
        assertEquals("attachment", OutputNames.sanitize(".."))
        assertEquals(120, OutputNames.sanitize("x".repeat(300)).length)
        assertEquals("Ảnh 1.jpg", OutputNames.sanitize("Ảnh 1.jpg"))
    }
}
