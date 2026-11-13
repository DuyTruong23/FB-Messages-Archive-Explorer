package app.fbmae

import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException

/** Serves the Vite build bundled in APK assets. */
class AppAssetsHandler(private val assets: AssetManager) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse {
        val assetPath = AssetMime.assetPathFor(path) ?: return notFound()
        return try {
            val mimeType = AssetMime.forPath(assetPath)
            WebResourceResponse(mimeType, AssetMime.encodingFor(mimeType), assets.open(assetPath))
        } catch (_: IOException) {
            notFound()
        }
    }

    private fun notFound() =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
}
