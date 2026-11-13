package app.fbmae

import android.content.SharedPreferences
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

interface ActivityPort {
    fun pickTree(initial: Uri?, onResult: (Uri?) -> Unit)
    fun createOutputDocument(name: String, mimeType: String, onResult: (Uri?) -> Unit)
    fun viewFile(file: File, mimeType: String)
    fun outputCacheDir(): File
}

/** Handles `fbmae` channel messages; see src/platform/android/nativeBridge.ts for the protocol. */
class SafBridge(
    private val store: SafStore,
    private val port: ActivityPort,
    private val prefs: SharedPreferences,
    private val binarySupported: Boolean,
) : WebViewCompat.WebMessageListener {
    private val executor = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())
    private val writers = WriterRegistry()

    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
        if (!isMainFrame) return
        if (binarySupported && message.type == WebMessageCompat.TYPE_ARRAY_BUFFER) {
            val bytes = message.arrayBuffer
            executor.execute { handleChunk(bytes, replyProxy) }
            return
        }
        val text = message.data ?: return
        executor.execute { handleRequest(text, replyProxy) }
    }

    fun shutdown() {
        executor.shutdownNow()
        writers.closeAll()
    }

    private fun handleRequest(text: String, reply: JavaScriptReplyProxy) {
        val request = try { JSONObject(text) } catch (_: JSONException) { return }
        val id = request.optInt("id")
        val args = request.optJSONObject("args") ?: JSONObject()
        try {
            when (request.optString("method")) {
                "hello" -> respond(reply, id, JSONObject().put("binary", binarySupported))
                "pickDirectory" -> pickDirectory(reply, id)
                "restoreDirectory" -> respond(reply, id, restoreDirectory())
                "rememberDirectory" -> {
                    val tree = tree(args)
                    prefs.edit().putString(KEY_OPEN_TREE, tree.toString()).apply()
                    respond(reply, id, JSONObject())
                }
                "readNavigation" -> respond(reply, id, JSONObject().put("value", prefs.getString(KEY_NAVIGATION, null) ?: JSONObject.NULL))
                "writeNavigation" -> {
                    val value = args.getString("value")
                    require(value.length <= MAX_NAVIGATION_CHARS) { "The navigation state is too large." }
                    prefs.edit().putString(KEY_NAVIGATION, value).apply()
                    respond(reply, id, JSONObject())
                }
                "listChildren" -> {
                    val tree = tree(args)
                    respond(reply, id, JSONObject().put("entries", store.listChildren(tree, document(args, "uri"))))
                }
                "createDocument" -> {
                    tree(args)
                    respond(reply, id, store.create(document(args, "parentUri"), args.getString("name"), args.optBoolean("directory")))
                }
                "deleteDocument" -> {
                    tree(args)
                    store.delete(document(args, "uri"))
                    respond(reply, id, JSONObject())
                }
                "openWriter" -> {
                    tree(args)
                    respond(reply, id, JSONObject().put("writerId", writers.open(store.openOutput(document(args, "uri")))))
                }
                "beginOutput" -> beginOutput(args, reply, id)
                "writeChunk" -> {
                    writers.write(args.getInt("writerId"), Base64.decode(args.getString("base64"), Base64.NO_WRAP))
                    respond(reply, id, JSONObject())
                }
                "closeWriter" -> {
                    writers.close(args.getInt("writerId"))
                    respond(reply, id, JSONObject())
                }
                "abortWriter" -> {
                    writers.abort(args.getInt("writerId"))
                    respond(reply, id, JSONObject())
                }
                else -> throw IllegalArgumentException("Unknown method.")
            }
        } catch (error: Throwable) {
            fail(reply, id, error)
        }
    }

    private fun tree(args: JSONObject): Uri {
        val tree = args.getString("treeUri")
        if (!TreeGuard.isTreeGranted(tree, store.grantedTrees()) && !TreeGuard.isTreeGranted(tree, store.refreshTrees())) {
            throw SecurityException("The folder permission is not granted.")
        }
        return Uri.parse(tree)
    }

    private fun document(args: JSONObject, key: String): Uri {
        val uri = args.getString(key)
        if (!TreeGuard.isAllowed(uri, listOf(args.getString("treeUri")))) throw SecurityException("The document is outside the folder.")
        return Uri.parse(uri)
    }

    private fun pickDirectory(reply: JavaScriptReplyProxy, id: Int) {
        val initial = prefs.getString(KEY_LAST_TREE, null)?.let { runCatching { store.rootDocument(Uri.parse(it)) }.getOrNull() }
        main.post {
            port.pickTree(initial) { tree ->
                executor.execute {
                    try {
                        if (tree == null) throw PickerCancelledException()
                        store.persist(tree)
                        prefs.edit().putString(KEY_LAST_TREE, tree.toString()).apply()
                        respond(reply, id, store.treeRoot(tree))
                    } catch (error: Throwable) {
                        fail(reply, id, error)
                    }
                }
            }
        }
    }

    /**
     * The last folder the app opened, or an empty object. A revoked grant forgets the folder;
     * an unreadable one (for example on an unmounted SD card) is kept for the next launch.
     */
    private fun restoreDirectory(): JSONObject {
        val saved = prefs.getString(KEY_OPEN_TREE, null) ?: return JSONObject()
        if (!TreeGuard.isTreeGranted(saved, store.refreshTrees())) {
            prefs.edit().remove(KEY_OPEN_TREE).apply()
            return JSONObject()
        }
        return runCatching { store.treeRoot(Uri.parse(saved)) }.getOrNull() ?: JSONObject()
    }

    private fun beginOutput(args: JSONObject, reply: JavaScriptReplyProxy, id: Int) {
        val name = OutputNames.sanitize(args.getString("name"))
        val mimeType = args.optString("mimeType", "application/octet-stream")
        when (args.getString("kind")) {
            "saveAs" -> main.post {
                port.createOutputDocument(name, mimeType) { uri ->
                    executor.execute {
                        try {
                            if (uri == null) throw PickerCancelledException()
                            respond(reply, id, JSONObject().put("writerId", writers.open(store.openOutput(uri))))
                        } catch (error: Throwable) {
                            fail(reply, id, error)
                        }
                    }
                }
            }
            "open" -> {
                val directory = File(port.outputCacheDir(), "open").apply { mkdirs() }
                val file = File(directory, name)
                val writerId = writers.open(FileOutputStream(file)) { main.post { port.viewFile(file, mimeType) } }
                respond(reply, id, JSONObject().put("writerId", writerId))
            }
            else -> throw IllegalArgumentException("Unknown output kind.")
        }
    }

    private fun handleChunk(bytes: ByteArray, reply: JavaScriptReplyProxy) {
        val frame = ChunkFrames.parse(bytes) ?: return
        try {
            writers.write(frame.writerId, bytes, frame.payloadOffset, bytes.size - frame.payloadOffset)
            respond(reply, frame.requestId, JSONObject())
        } catch (error: Throwable) {
            fail(reply, frame.requestId, error)
        }
    }

    private fun respond(reply: JavaScriptReplyProxy, id: Int, result: JSONObject) =
        post(reply, JSONObject().put("id", id).put("ok", true).put("result", result))

    private fun fail(reply: JavaScriptReplyProxy, id: Int, error: Throwable) {
        val detail = JSONObject().put("name", DomErrors.nameFor(error)).put("message", error.message ?: error.javaClass.simpleName)
        post(reply, JSONObject().put("id", id).put("ok", false).put("error", detail))
    }

    private fun post(reply: JavaScriptReplyProxy, json: JSONObject) {
        val text = json.toString()
        main.post { reply.postMessage(text) }
    }

    companion object {
        private const val KEY_LAST_TREE = "lastTree"
        private const val KEY_OPEN_TREE = "openTree"
        private const val KEY_NAVIGATION = "navigation"
        private const val MAX_NAVIGATION_CHARS = 64 * 1024
    }
}
