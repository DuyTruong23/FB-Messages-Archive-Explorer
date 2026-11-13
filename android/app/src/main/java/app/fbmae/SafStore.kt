package app.fbmae

import android.content.ContentResolver
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** ContentResolver operations on SAF trees. Every URI is a tree-based document URI. */
class SafStore(private val resolver: ContentResolver) {
    @Volatile
    private var trees: List<String>? = null

    fun grantedTrees(): List<String> = trees ?: refreshTrees()

    fun refreshTrees(): List<String> = resolver.persistedUriPermissions
        .filter { it.isReadPermission && it.isWritePermission }
        .map { it.uri.toString() }
        .also { trees = it }

    fun persist(tree: Uri) {
        resolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        refreshTrees()
    }

    fun rootDocument(tree: Uri): Uri =
        DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))

    fun treeRoot(tree: Uri): JSONObject {
        val root = rootDocument(tree)
        val entry = describe(root) ?: throw FileNotFoundException(root.toString())
        return entry.put("treeUri", tree.toString())
    }

    fun listChildren(tree: Uri, document: Uri): JSONArray {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(document))
        val result = JSONArray()
        val cursor = resolver.query(children, PROJECTION, null, null, null) ?: throw FileNotFoundException(document.toString())
        cursor.use {
            while (it.moveToNext()) result.put(entry(DocumentsContract.buildDocumentUriUsingTree(tree, it.getString(0)), it))
        }
        return result
    }

    fun create(parent: Uri, name: String, directory: Boolean): JSONObject {
        // octet-stream keeps providers from appending an extension to the exact name.
        val mimeType = if (directory) Document.MIME_TYPE_DIR else "application/octet-stream"
        val created = DocumentsContract.createDocument(resolver, parent, mimeType, name) ?: throw IOException("Could not create $name.")
        return describe(created) ?: throw FileNotFoundException(created.toString())
    }

    fun delete(document: Uri) {
        if (!DocumentsContract.deleteDocument(resolver, document)) throw IOException("Could not delete the document.")
    }

    fun openOutput(document: Uri): OutputStream =
        resolver.openOutputStream(document, "wt") ?: throw FileNotFoundException(document.toString())

    fun openInput(document: Uri): InputStream =
        resolver.openInputStream(document) ?: throw FileNotFoundException(document.toString())

    fun mimeType(document: Uri): String = resolver.getType(document) ?: "application/octet-stream"

    private fun describe(document: Uri): JSONObject? =
        resolver.query(document, PROJECTION, null, null, null)?.use { if (it.moveToFirst()) entry(document, it) else null }

    private fun entry(uri: Uri, cursor: Cursor): JSONObject {
        val mimeType = cursor.getString(2) ?: "application/octet-stream"
        return JSONObject()
            .put("uri", uri.toString())
            .put("name", cursor.getString(1))
            .put("mimeType", mimeType)
            .put("directory", mimeType == Document.MIME_TYPE_DIR)
            .put("size", if (cursor.isNull(3)) 0 else cursor.getLong(3))
            .put("lastModified", if (cursor.isNull(4)) 0 else cursor.getLong(4))
    }

    companion object {
        private val PROJECTION = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE,
            Document.COLUMN_LAST_MODIFIED,
        )
    }
}
