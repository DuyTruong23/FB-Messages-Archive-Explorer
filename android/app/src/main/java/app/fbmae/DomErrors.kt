package app.fbmae

import java.io.FileNotFoundException
import java.io.IOException

class PickerCancelledException : Exception("The picker was cancelled.")

object DomErrors {
    fun nameFor(error: Throwable): String = when (error) {
        is PickerCancelledException -> "AbortError"
        is SecurityException -> "NotAllowedError"
        is FileNotFoundException -> "NotFoundError"
        is IOException -> "NotReadableError"
        is IllegalStateException -> "InvalidStateError"
        is IllegalArgumentException -> "NotSupportedError"
        else -> "UnknownError"
    }
}
