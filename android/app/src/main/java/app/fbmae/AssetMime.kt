package app.fbmae

/** MIME and path rules for the bundled web app. Module scripts need an exact JS MIME type. */
object AssetMime {
    private val types = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "mjs" to "text/javascript",
        "css" to "text/css",
        "json" to "application/json",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "ico" to "image/x-icon",
        "webmanifest" to "application/manifest+json",
        "woff2" to "font/woff2",
        "wasm" to "application/wasm",
        "txt" to "text/plain",
    )

    fun forPath(path: String): String =
        types[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"

    fun encodingFor(mimeType: String): String? =
        if (mimeType.startsWith("text/") || mimeType.endsWith("json") || mimeType.endsWith("xml")) "utf-8" else null

    /** Maps a request path to an asset path, or null when it would leave the asset root. */
    fun assetPathFor(path: String): String? {
        val clean = path.substringBefore('?').substringBefore('#').trimStart('/')
        if (clean.split('/').any { it == ".." }) return null
        return clean.ifEmpty { "index.html" }
    }
}
