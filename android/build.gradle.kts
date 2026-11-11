import java.util.Properties

plugins {
    id("com.android.application") version "9.5.0" apply false
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}

// fbmae.outputRoot keeps build output off the source drive (F: on the owner's machine).
val outputRoot: String? = localProperties.getProperty("fbmae.outputRoot")
if (outputRoot != null) {
    allprojects {
        layout.buildDirectory.set(file("$outputRoot/android-build/${project.name}"))
    }
}

extra["fbmaeWebDir"] = outputRoot?.let { "$it/android-web" } ?: rootProject.file("../dist-android").path
