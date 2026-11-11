import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appBase = '/FB-Messages-Archive-Explorer/'

function servePublicGuide(): Plugin {
  return {
    name: 'serve-public-guide',
    apply: 'serve',
    configureServer(server) {
      // Vite's dev public-file lookup requires an exact filename, unlike Pages.
      const guidePath = `${appBase}guide/`
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (url.pathname === guidePath.slice(0, -1)) {
          res.writeHead(302, { Location: `${guidePath}${url.search}` })
          res.end()
          return
        }
        if (url.pathname === guidePath) {
          req.url = `${guidePath}index.html${url.search}`
        }
        next()
      })
    },
  }
}

function pwa() {
  return VitePWA({
    strategies: 'generateSW',
    registerType: 'prompt',
    scope: appBase,
    workbox: {
      cacheId: 'fb-messages-archive-explorer',
      // Manifest icons and manifest.webmanifest are added by the plugin separately.
      // Keep the public guide and demo screenshot out of the app's offline cache.
      globPatterns: ['**/*.{js,css,html,ico,svg}'],
      globIgnores: ['**/guide/**'],
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [
        /^\/FB-Messages-Archive-Explorer\/guide(?:[/?]|$)/,
        /^\/FB-Messages-Archive-Explorer\/sitemap\.xml(?:\?|$)/,
      ],
      cleanupOutdatedCaches: true,
    },
    manifest: {
      id: appBase,
      name: 'FB Messages Archive Explorer',
      short_name: 'FB Archive',
      description: 'Browse your Facebook Messenger archive locally and privately.',
      theme_color: '#0b1116',
      background_color: '#0b1116',
      display: 'standalone',
      start_url: appBase,
      scope: appBase,
      icons: [
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    devOptions: {
      enabled: false,
    },
  })
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode !== 'android') {
    return {
      base: appBase,
      plugins: [servePublicGuide(), react(), pwa()],
    }
  }

  // Android bundle: served from APK assets at https://appassets.androidplatform.net/.
  const outputRoot = process.env.FBMAE_OUTPUT_ROOT
  return {
    base: '/',
    publicDir: false,
    build: {
      outDir: outputRoot ? join(outputRoot, 'android-web') : 'dist-android',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        'virtual:pwa-register/react': fileURLToPath(new URL('./src/platform/android/pwaRegisterStub.ts', import.meta.url)),
      },
    },
    plugins: [react()],
  }
})
