package app.fbmae

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File

class MainActivity : Activity(), ActivityPort {
    private lateinit var container: FrameLayout
    private lateinit var webView: WebView
    private lateinit var store: SafStore
    private lateinit var bridge: SafBridge
    private var pendingTree: ((Uri?) -> Unit)? = null
    private var pendingOutput: ((Uri?) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Toast.makeText(this, R.string.webview_too_old, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        File(cacheDir, "open").deleteRecursively()
        store = SafStore(contentResolver)
        bridge = SafBridge(
            store, this, getSharedPreferences("fbmae", MODE_PRIVATE),
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER),
        )
        window.setDecorFitsSystemWindows(false)
        container = FrameLayout(this)
        setContentView(container)
        applyInsets(container)
        createWebView()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
        }
    }

    private fun createWebView() {
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/saf/", SafPathHandler(store))
            .addPathHandler("/", AppAssetsHandler(assets))
            .build()
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportMultipleWindows(false)
            webViewClient = AppClient(loader)
        }
        WebViewCompat.addWebMessageListener(webView, "fbmae", setOf(APP_ORIGIN), bridge)
        container.addView(webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView.loadUrl(APP_URL)
    }

    override fun pickTree(initial: Uri?, onResult: (Uri?) -> Unit) {
        pendingTree?.invoke(null)
        pendingTree = onResult
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
        )
        if (initial != null) intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial)
        startActivityForResult(intent, REQUEST_TREE)
    }

    override fun createOutputDocument(name: String, mimeType: String, onResult: (Uri?) -> Unit) {
        pendingOutput?.invoke(null)
        pendingOutput = onResult
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, name)
        startActivityForResult(intent, REQUEST_OUTPUT)
    }

    override fun viewFile(file: File, mimeType: String) {
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            startActivity(Intent.createChooser(view, null))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_viewer, Toast.LENGTH_SHORT).show()
        }
    }

    override fun outputCacheDir(): File = cacheDir

    @Deprecated("Activity result API without androidx.activity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = if (resultCode == RESULT_OK) data?.data else null
        when (requestCode) {
            REQUEST_TREE -> pendingTree.also { pendingTree = null }?.invoke(uri)
            REQUEST_OUTPUT -> pendingOutput.also { pendingOutput = null }?.invoke(uri)
        }
    }

    private fun applyInsets(view: View) {
        view.setOnApplyWindowInsetsListener { target, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
            target.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    private fun handleBack() {
        if (webView.canGoBack()) webView.goBack() else finish()
    }

    @Deprecated("Used below API 33 only")
    override fun onBackPressed() {
        handleBack()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (::bridge.isInitialized) bridge.shutdown()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    private inner class AppClient(private val loader: WebViewAssetLoader) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            loader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.host == APP_HOST) return false
            if (url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto") {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (_: ActivityNotFoundException) {
                    Toast.makeText(this@MainActivity, R.string.no_viewer, Toast.LENGTH_SHORT).show()
                }
            }
            return true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            container.removeView(view)
            view.destroy()
            createWebView()
            Toast.makeText(this@MainActivity, R.string.reloaded, Toast.LENGTH_LONG).show()
            return true
        }
    }

    companion object {
        const val APP_HOST = "appassets.androidplatform.net"
        const val APP_ORIGIN = "https://$APP_HOST"
        const val APP_URL = "$APP_ORIGIN/index.html"
        private const val REQUEST_TREE = 1
        private const val REQUEST_OUTPUT = 2
    }
}
