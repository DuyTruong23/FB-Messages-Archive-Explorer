package app.fbmae

import android.net.Uri
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.IOException

/** Streams granted documents for `fetch('/saf/<base64url document URI>')`. */
class SafPathHandler(private val store: SafStore) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse {
        val uri = SafPath.decode(path) ?: return status(400, "Bad Request")
        if (!TreeGuard.isAllowed(uri, store.grantedTrees())) return status(403, "Forbidden")
        return try {
            val document = Uri.parse(uri)
            WebResourceResponse(store.mimeType(document), null, store.openInput(document))
        } catch (_: SecurityException) {
            status(403, "Forbidden")
        } catch (_: FileNotFoundException) {
            status(404, "Not Found")
        } catch (_: IOException) {
            status(500, "Read Error")
        }
    }

    private fun status(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))
}
