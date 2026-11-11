package app.fbmae

import java.util.Base64

object SafPath {
    /** Decodes the base64url segment after `/saf/` into a document URI string. */
    fun decode(path: String): String? {
        val segment = path.substringBefore('/').substringBefore('?')
        if (segment.isEmpty()) return null
        return try {
            String(Base64.getUrlDecoder().decode(segment), Charsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
