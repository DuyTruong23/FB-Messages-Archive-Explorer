package app.fbmae

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AssetMimeTest {
    @Test
    fun mapsWebTypes() {
        assertEquals("text/javascript", AssetMime.forPath("assets/index-abc.js"))
        assertEquals("text/css", AssetMime.forPath("assets/index.CSS"))
        assertEquals("text/html", AssetMime.forPath("index.html"))
        assertEquals("image/svg+xml", AssetMime.forPath("a/b.svg"))
        assertEquals("application/octet-stream", AssetMime.forPath("README"))
    }

    @Test
    fun usesUtf8OnlyForText() {
        assertEquals("utf-8", AssetMime.encodingFor("text/javascript"))
        assertEquals("utf-8", AssetMime.encodingFor("application/json"))
        assertNull(AssetMime.encodingFor("image/png"))
    }

    @Test
    fun mapsRequestPathsToAssets() {
        assertEquals("index.html", AssetMime.assetPathFor(""))
        assertEquals("index.html", AssetMime.assetPathFor("/"))
        assertEquals("assets/a.js", AssetMime.assetPathFor("assets/a.js?v=2"))
        assertNull(AssetMime.assetPathFor("assets/../../secret"))
    }
}
