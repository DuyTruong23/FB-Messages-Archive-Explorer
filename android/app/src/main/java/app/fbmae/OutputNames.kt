package app.fbmae

object OutputNames {
    private val unsafe = Regex("[\\\\/:*?\"<>|\\p{Cntrl}]")

    fun sanitize(name: String): String {
        val clean = name.replace(unsafe, "_").trim().take(120)
        return if (clean.isEmpty() || clean == "." || clean == "..") "attachment" else clean
    }
}
