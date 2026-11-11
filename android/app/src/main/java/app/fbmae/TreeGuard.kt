package app.fbmae

object TreeGuard {
    /**
     * True when [documentUri] has the shape DocumentsContract.buildDocumentUriUsingTree
     * produces under one of [trees]. The document provider itself rejects tree URIs whose
     * document is not a descendant of the tree, so a prefix check is enough here.
     */
    fun isAllowed(documentUri: String, trees: Collection<String>): Boolean = trees.any { tree ->
        val prefix = "$tree/document/"
        if (!documentUri.startsWith(prefix)) return@any false
        val documentId = documentUri.substring(prefix.length)
        documentId.isNotEmpty() && '/' !in documentId
    }

    fun isTreeGranted(treeUri: String, trees: Collection<String>): Boolean = treeUri in trees
}
