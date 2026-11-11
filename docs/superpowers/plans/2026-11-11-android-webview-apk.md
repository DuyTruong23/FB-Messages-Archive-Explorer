# Android WebView APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. The owner's global rules forbid subagents, so execute inline, one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sideloadable Android APK (≤ 3 MB target) that runs the existing web app in a WebView, with full read and write access to an extracted export folder through the Android Storage Access Framework (SAF).

**Architecture:** A plain Kotlin `Activity` hosts one WebView that loads the Vite build from APK assets through `WebViewAssetLoader` at `https://appassets.androidplatform.net/`. An Android-only JS module installs `window.showDirectoryPicker`, which returns SAF-backed handles that implement the handle interfaces in `src/types/fileSystem.ts`. Control calls go over a `WebMessageListener` channel named `fbmae`. File bytes are read through a `/saf/` path handler and written in 1 MB chunks.

**Tech Stack:**
- Web: React 19, TypeScript 6, Vite 8, Vitest 4.
- Android: AGP 9.5.0 with built-in Kotlin, Gradle 9.8.2, `androidx.webkit:webkit:1.18.0`, JUnit 4.13.2.

**Spec:** `docs/superpowers/specs/2026-11-11-android-webview-apk-design.md`

## Global Constraints

- Work only in the worktree `D:\Personal\Coding\FB-Messages-Archive-Explorer-android`, on branch `feat/android-webview`.
- Android: `applicationId`/`namespace` `app.fbmae`; `minSdk 30`; `compileSdk 37`; `targetSdk 37`; Java/Kotlin target 17. `minSdk` was raised from the spec's 29 so the insets code can use `WindowInsets.Type` without a legacy branch.
- The only runtime library is `androidx.webkit:webkit:1.18.0`. `FileProvider` comes from its transitive `androidx.core`.
- The APK has no `INTERNET` permission.
- Build outputs go under `F:\Project\FB-Messages-Archive-Explorer\`:
  - `android-web\`: Vite android bundle;
  - `android-build\`: Gradle build directories;
  - `.gradle-project\`: project cache.
- `GRADLE_USER_HOME` stays `F:\Project\.gradle`.
- Before any build, check `Test-Path F:\`. If F: is missing, stop and ask the owner.
- One Gradle build at a time, guarded by `F:\Project\FB-Messages-Archive-Explorer\gradle.lock`. Never run `gradlew --stop`; stop only your own PID.
- The web bundle for the hosted site must not change. All Android behavior is gated by `import.meta.env.MODE === 'android'`.
- Device work only on the S23 (`adb -s RFCX70GZ85Y`):
  - only when `D:\Personal\Coding\.s23.lock` is absent; create the lock when starting and delete it when done;
  - `install`, `pm` and `am` always take `--user 0`;
  - use fake data only and clean it up afterwards.
- Code, identifiers and commit messages are in English. Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Model per task (owner rule): Task 0 and Task 11 `haiku`; Task 9 `opus`; all other tasks `sonnet`.

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/config/platform.ts` | `isAndroidApp()` flag |
| `src/platform/android/pwaRegisterStub.ts` | Inert `useRegisterSW` for the Android bundle |
| `src/platform/android/nativeBridge.ts` | Request/response transport over the `fbmae` port, plus binary chunk frames |
| `src/platform/android/safHandles.ts` | `SafDirectoryHandle`, `SafFileHandle`, `SafWritable` |
| `src/platform/android/safNative.ts` | `createAndroidNative()`: maps the `SafNative` API onto bridge calls and `/saf/` fetches |
| `src/platform/android/androidDownloads.ts` | Blob registry, `<a download>` interception, `window.open` patch |
| `src/platform/android/install.ts` | `installAndroidPlatform()`: wires everything onto `window` |
| `scripts/build-android.mjs` | Lock + F: check, then the web bundle, then Gradle, then the permission gate |
| `scripts/make-fake-archive.mjs` | Generates fake Facebook and Messenger archives plus media for the device test |
| `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/wrapper/*`, `android/gradlew*` | Gradle project |
| `android/app/build.gradle.kts`, `android/app/proguard-rules.pro` | App module |
| `android/app/src/main/AndroidManifest.xml`, `res/**` | Manifest, theme, strings, icon, `FileProvider` paths |
| `android/app/src/main/java/app/fbmae/AssetMime.kt` | Asset path and MIME rules (pure) |
| `android/app/src/main/java/app/fbmae/AppAssetsHandler.kt` | Serves the bundled web app |
| `android/app/src/main/java/app/fbmae/SafPath.kt` | Decodes `/saf/<base64url>` (pure) |
| `android/app/src/main/java/app/fbmae/TreeGuard.kt` | Checks document URIs against granted trees (pure) |
| `android/app/src/main/java/app/fbmae/WriterRegistry.kt` | Open output streams by id (pure) |
| `android/app/src/main/java/app/fbmae/DomErrors.kt` | Exception → `DOMException` name, plus `PickerCancelledException` (pure) |
| `android/app/src/main/java/app/fbmae/ChunkFrames.kt` | Parses binary chunk frames (pure) |
| `android/app/src/main/java/app/fbmae/OutputNames.kt` | Sanitizes output file names (pure) |
| `android/app/src/main/java/app/fbmae/SafStore.kt` | `ContentResolver` and `DocumentsContract` operations |
| `android/app/src/main/java/app/fbmae/SafPathHandler.kt` | Streams documents for `/saf/` |
| `android/app/src/main/java/app/fbmae/SafBridge.kt` | `WebMessageListener` dispatcher |
| `android/app/src/main/java/app/fbmae/MainActivity.kt` | WebView host, pickers, external viewer, Back, insets |

---

### Task 0: Workspace setup (model: haiku)

**Files:** none

- [ ] **Step 1: Install dependencies in the worktree**

Run in `D:\Personal\Coding\FB-Messages-Archive-Explorer-android`:

```bash
npm ci
```

Expected: exit code 0.

- [ ] **Step 2: Record the baseline**

```bash
npm test
```

```bash
npm run lint
```

Expected: both pass. Note the test file count and test count from the Vitest summary for comparison in Task 11.

---

### Task 1: Android build mode for the web bundle (model: sonnet)

**Files:**
- Create: `src/config/platform.ts`
- Create: `src/platform/android/pwaRegisterStub.ts`
- Create: `src/platform/android/install.ts` (placeholder export that later tasks fill in)
- Modify: `vite.config.ts` (whole file)
- Modify: `vitest.config.ts` (whole file)
- Modify: `src/main.tsx:20-34`
- Modify: `package.json` (`scripts`)
- Modify: `.gitignore`
- Test: `test/platform.test.ts`

**Interfaces:**
- Produces: `isAndroidApp(): boolean`; `installAndroidPlatform(win?: Window): Promise<void>`; npm script `build:web:android`; output folder `dist-android/`, or `$FBMAE_OUTPUT_ROOT/android-web/` when that variable is set.

- [ ] **Step 1: Write the failing test**

`test/platform.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAndroidApp } from '../src/config/platform';

describe('isAndroidApp', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is false in the web build', () => {
    expect(isAndroidApp()).toBe(false);
  });

  it('is true in android mode', () => {
    vi.stubEnv('MODE', 'android');
    expect(isAndroidApp()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/platform.test.ts`
Expected: FAIL, because `../src/config/platform` cannot be resolved.

- [ ] **Step 3: Implement the flag**

`src/config/platform.ts`:

```ts
/** True only in the bundle built with `vite build --mode android`. */
export function isAndroidApp(): boolean {
  return import.meta.env.MODE === 'android';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/platform.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the PWA stub and the install entry point**

`src/platform/android/pwaRegisterStub.ts`:

```ts
import { useState } from 'react';

// The Android bundle has no service worker. ReloadPrompt is not rendered there,
// but the module must still resolve for the shared import graph.
export function useRegisterSW() {
  const offlineReady = useState(false);
  const needRefresh = useState(false);
  return {
    offlineReady,
    needRefresh,
    updateServiceWorker: async () => {},
  };
}
```

`src/platform/android/install.ts` (replaced in Task 5):

```ts
export async function installAndroidPlatform(): Promise<void> {}
```

- [ ] **Step 6: Make the Vite config mode-aware**

Replace `vite.config.ts` with:

```ts
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
```

- [ ] **Step 7: Adapt the Vitest config to the function config**

Replace `vitest.config.ts` with:

```ts
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig(env => mergeConfig(viteConfig(env), defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    benchmark: { include: ['test/**/*.bench.{ts,tsx,js,jsx}'] },
  },
})));
```

- [ ] **Step 8: Install the platform before rendering**

In `src/main.tsx`, replace the `createRoot(...)` block (lines 28-34) with:

```tsx
const platformReady = import.meta.env.MODE === 'android'
  ? import('./platform/android/install')
    .then(module => module.installAndroidPlatform())
    .catch(error => console.error('[Android] Platform install failed:', error))
  : Promise.resolve();

void platformReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
```

- [ ] **Step 9: Add the script and ignore the output folder**

In `package.json` `scripts`, add after `"build"`:

```json
"build:web:android": "tsc -b && vite build --mode android",
```

Append to `.gitignore`:

```
dist-android
```

- [ ] **Step 10: Verify both bundles**

```bash
npx vitest run test/platform.test.ts
```

```bash
npm run build
```

```bash
npm run build:web:android
```

```bash
ls dist-android dist-android/assets
```

Expected:
- `dist/` still contains `sw.js` and `manifest.webmanifest`.
- `dist-android/` contains `index.html` and `assets/`, but no `sw.js`, `manifest.webmanifest`, `guide/` or `demo.png`.
- `dist-android/index.html` references `/assets/…`, not `/FB-Messages-Archive-Explorer/assets/…`.

- [ ] **Step 11: Commit**

```bash
git add src/config/platform.ts src/platform/android vite.config.ts vitest.config.ts src/main.tsx package.json .gitignore test/platform.test.ts
git commit -m "build(android): add android Vite mode without service worker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Android-only UI adjustments (model: sonnet)

**Files:**
- Modify: `src/components/Sidebar/FolderAccessOptions.tsx:11-13`
- Modify: `src/services/fileSystem.ts:83-96`
- Modify: `src/components/Sidebar/SettingsPanel.tsx:474-485` and its imports
- Modify: `src/App.tsx:496` and its imports
- Test: `test/androidPlatformUi.test.tsx`

**Interfaces:**
- Consumes: `isAndroidApp()` from Task 1.

- [ ] **Step 1: Write the failing tests**

`test/androidPlatformUi.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FolderAccessOptions } from '../src/components/Sidebar/FolderAccessOptions';
import { pickFolderWithWriteAccess, pickMessagesFolder } from '../src/services/fileSystem';

describe('Android app UI', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('hides folder access options in the Android app', () => {
    vi.stubEnv('MODE', 'android');
    const { container } = render(<FolderAccessOptions mode="upload" onChange={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps folder access options on the web', () => {
    const { getAllByText } = render(<FolderAccessOptions mode="native" onChange={() => {}} />);
    expect(getAllByText('Folder access').length).toBeGreaterThan(0);
  });

  it('uses the native picker in the Android app even when upload mode is saved', async () => {
    vi.stubEnv('MODE', 'android');
    const handle = { kind: 'directory', name: 'root' };
    const picker = vi.fn().mockResolvedValue(handle);
    // Set it on the jsdom window itself; it may not be the same object as globalThis.
    Object.defineProperty(window, 'showDirectoryPicker', { value: picker, configurable: true, writable: true });
    try {
      await expect(pickMessagesFolder('upload')).resolves.toBe(handle);
      await expect(pickFolderWithWriteAccess('upload')).resolves.toBe(handle);
      expect(picker).toHaveBeenNthCalledWith(1, { id: 'messages-folder', mode: 'read' });
      expect(picker).toHaveBeenNthCalledWith(2, { id: 'messages-folder', mode: 'readwrite' });
    } finally {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/androidPlatformUi.test.tsx`
Expected: tests 1 and 3 FAIL. The options still render, and upload mode calls the folder-upload polyfill instead of the picker.

- [ ] **Step 3: Hide the folder access options**

In `src/components/Sidebar/FolderAccessOptions.tsx`, add the import and an early return after `useId()`, so hook order stays stable:

```tsx
import { isAndroidApp } from '../../config/platform';
```

```tsx
  const id = useId();
  if (isAndroidApp()) return null;
  const nativeSupported = isFileSystemAccessSupported();
```

- [ ] **Step 4: Force native access in the pickers**

In `src/services/fileSystem.ts`, add `import { isAndroidApp } from '../config/platform';` next to the existing imports. Replace both picker functions with:

```ts
function shouldUseUploadFallback(accessMode: FolderAccessMode): boolean {
  // The Android app always opens folders through the SAF picker shim.
  if (isAndroidApp()) return false;
  return accessMode === 'upload' || !isFileSystemAccessSupported();
}

export async function pickMessagesFolder(accessMode: FolderAccessMode = 'native', onPreparationProgress?: (done: number, total: number) => void): Promise<ReadableDirectoryHandle> {
  if (shouldUseUploadFallback(accessMode)) {
    return openFolderPolyfill(onPreparationProgress);
  }
  return window.showDirectoryPicker({ id: 'messages-folder', mode: 'read' });
}

export async function pickFolderWithWriteAccess(accessMode: FolderAccessMode = 'native', onPreparationProgress?: (done: number, total: number) => void): Promise<ReadableDirectoryHandle> {
  if (shouldUseUploadFallback(accessMode)) {
    // Upload fallback handles are read-only but still support archive browsing.
    return openFolderPolyfill(onPreparationProgress);
  }
  return window.showDirectoryPicker({ id: 'messages-folder', mode: 'readwrite' });
}
```

- [ ] **Step 5: Hide offline settings and the reload prompt**

In `src/components/Sidebar/SettingsPanel.tsx`:
- add `import { isAndroidApp } from '../../config/platform';`;
- wrap the whole `<SettingsSection title="Offline use" …>…</SettingsSection>` block (lines 474-485) in `{!isAndroidApp() && (` … `)}`.

In `src/App.tsx`:
- add `import { isAndroidApp } from './config/platform';`;
- change line 496 to:

```tsx
          {!isAndroidApp() && <ReloadPrompt canAutoReload={!archive.rootHandle && !archive.loading} />}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/androidPlatformUi.test.tsx`
Expected: PASS, 3 tests.

Run: `npm test`
Expected: PASS; the baseline count plus 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar/FolderAccessOptions.tsx src/services/fileSystem.ts src/components/Sidebar/SettingsPanel.tsx src/App.tsx test/androidPlatformUi.test.tsx
git commit -m "feat(android): hide upload and offline options in the Android app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Native message bridge (model: sonnet)

**Files:**
- Create: `src/platform/android/nativeBridge.ts`
- Test: `test/androidNativeBridge.test.ts`

**Interfaces:**
- Produces:
  - `interface NativePort { postMessage(message: string | ArrayBuffer): void; addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void }`
  - `interface NativeBridge { call<T>(method: string, args?: Record<string, unknown>, timeoutMs?: number | null): Promise<T>; sendChunk(writerId: number, bytes: Uint8Array): Promise<void>; readonly binary: boolean }`
  - `connectNativeBridge(port: NativePort, timeoutMs?: number): Promise<NativeBridge>`
  - `NATIVE_TIMEOUT_MS = 60_000`
  - `bytesToBase64(bytes: Uint8Array): string`
- Wire protocol (Kotlin side implements it in Task 9):
  - JS → native: JSON `{ id, method, args }`, or a binary frame `[u32 LE requestId][u32 LE writerId][payload]`.
  - Native → JS: JSON `{ id, ok: true, result }` or `{ id, ok: false, error: { name, message } }`.
  - The first call is `hello` → `{ binary: boolean }`.

- [ ] **Step 1: Write the failing tests**

`test/androidNativeBridge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64, connectNativeBridge, type NativePort } from '../src/platform/android/nativeBridge';

class FakePort implements NativePort {
  sent: Array<string | ArrayBuffer> = [];
  private listeners: Array<(event: { data: unknown }) => void> = [];

  constructor(private readonly binary = true) {}

  postMessage(message: string | ArrayBuffer): void {
    this.sent.push(message);
    if (typeof message !== 'string') return;
    const request = JSON.parse(message) as { id: number; method: string };
    if (request.method === 'hello') {
      queueMicrotask(() => this.reply({ id: request.id, ok: true, result: { binary: this.binary } }));
    }
  }

  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.push(listener);
  }

  reply(value: unknown): void {
    for (const listener of this.listeners) listener({ data: JSON.stringify(value) });
  }

  lastRequest(): { id: number; method: string; args: Record<string, unknown> } {
    return JSON.parse(this.sent.at(-1) as string);
  }
}

describe('connectNativeBridge', () => {
  afterEach(() => vi.useRealTimers());

  it('reads binary support from the hello handshake', async () => {
    expect((await connectNativeBridge(new FakePort(true))).binary).toBe(true);
    expect((await connectNativeBridge(new FakePort(false))).binary).toBe(false);
  });

  it('resolves a call with its result', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port);
    const result = bridge.call<{ entries: string[] }>('listChildren', { uri: 'a' });
    const request = port.lastRequest();
    expect(request).toMatchObject({ method: 'listChildren', args: { uri: 'a' } });
    port.reply({ id: request.id, ok: true, result: { entries: ['x'] } });
    await expect(result).resolves.toEqual({ entries: ['x'] });
  });

  it('rejects a call with a DOMException carrying the native error name', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port);
    const result = bridge.call('deleteDocument');
    port.reply({ id: port.lastRequest().id, ok: false, error: { name: 'NotAllowedError', message: 'denied' } });
    await expect(result).rejects.toMatchObject({ name: 'NotAllowedError', message: 'denied' });
  });

  it('times out a call without a reply', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port, 1000);
    vi.useFakeTimers();
    const result = bridge.call('listChildren');
    vi.advanceTimersByTime(1001);
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('never times out a call with a null timeout', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port, 1000);
    vi.useFakeTimers();
    let settled = false;
    const result = bridge.call('pickDirectory', {}, null).finally(() => { settled = true; });
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(settled).toBe(false);
    port.reply({ id: port.lastRequest().id, ok: true, result: {} });
    await result;
  });

  it('sends a binary frame with request id, writer id, and payload', async () => {
    const port = new FakePort(true);
    const bridge = await connectNativeBridge(port);
    const sent = bridge.sendChunk(7, new Uint8Array([1, 2, 3]));
    const frame = new Uint8Array(port.sent.at(-1) as ArrayBuffer);
    const view = new DataView(frame.buffer);
    const requestId = view.getUint32(0, true);
    expect(view.getUint32(4, true)).toBe(7);
    expect([...frame.subarray(8)]).toEqual([1, 2, 3]);
    port.reply({ id: requestId, ok: true, result: {} });
    await expect(sent).resolves.toBeUndefined();
  });

  it('falls back to base64 chunks without binary support', async () => {
    const port = new FakePort(false);
    const bridge = await connectNativeBridge(port);
    const sent = bridge.sendChunk(3, new Uint8Array([104, 105]));
    const request = port.lastRequest();
    expect(request).toMatchObject({ method: 'writeChunk', args: { writerId: 3, base64: 'aGk=' } });
    port.reply({ id: request.id, ok: true, result: {} });
    await expect(sent).resolves.toBeUndefined();
  });
});

describe('bytesToBase64', () => {
  it('encodes large arrays without exceeding the argument limit', () => {
    const bytes = new Uint8Array(200_000).fill(65);
    expect(atob(bytesToBase64(bytes))).toBe('A'.repeat(200_000));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/androidNativeBridge.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement the bridge**

`src/platform/android/nativeBridge.ts`:

```ts
/** The object Android injects with WebViewCompat.addWebMessageListener. */
export interface NativePort {
  postMessage(message: string | ArrayBuffer): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface NativeBridge {
  /** `timeoutMs: null` waits indefinitely, for calls that show a system picker. */
  call<T>(method: string, args?: Record<string, unknown>, timeoutMs?: number | null): Promise<T>;
  sendChunk(writerId: number, bytes: Uint8Array): Promise<void>;
  readonly binary: boolean;
}

interface Reply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { name?: string; message?: string };
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
}

export const NATIVE_TIMEOUT_MS = 60_000;

export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(text);
}

export async function connectNativeBridge(port: NativePort, timeoutMs = NATIVE_TIMEOUT_MS): Promise<NativeBridge> {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  port.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    let reply: Reply;
    try {
      reply = JSON.parse(event.data) as Reply;
    } catch {
      return;
    }
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (entry.timer !== null) clearTimeout(entry.timer);
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(new DOMException(reply.error?.message ?? 'The native call failed.', reply.error?.name ?? 'UnknownError'));
  });

  function track<T>(id: number, method: string, limit: number | null): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = limit === null ? null : setTimeout(() => {
        pending.delete(id);
        reject(new DOMException(`${method} did not respond.`, 'TimeoutError'));
      }, limit);
      pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    });
  }

  function call<T>(method: string, args: Record<string, unknown> = {}, limit: number | null = timeoutMs): Promise<T> {
    const id = nextId++;
    const result = track<T>(id, method, limit);
    port.postMessage(JSON.stringify({ id, method, args }));
    return result;
  }

  const hello = await call<{ binary?: boolean }>('hello');
  const binary = hello?.binary === true;

  async function sendChunk(writerId: number, bytes: Uint8Array): Promise<void> {
    if (!binary) {
      await call('writeChunk', { writerId, base64: bytesToBase64(bytes) });
      return;
    }
    const id = nextId++;
    const result = track<void>(id, 'writeChunk', timeoutMs);
    const frame = new Uint8Array(8 + bytes.byteLength);
    const header = new DataView(frame.buffer);
    header.setUint32(0, id, true);
    header.setUint32(4, writerId, true);
    frame.set(bytes, 8);
    port.postMessage(frame.buffer);
    await result;
  }

  return { call, sendChunk, binary };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/androidNativeBridge.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/platform/android/nativeBridge.ts test/androidNativeBridge.test.ts
git commit -m "feat(android): add the native message bridge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: SAF-backed directory and file handles (model: sonnet)

**Files:**
- Create: `src/platform/android/safHandles.ts`
- Test: `test/androidSafHandles.test.ts`

**Interfaces:**
- Consumes: `WritableDirectoryHandle`, `WritableFileHandle` and `ReadableEntryHandle` from `src/types/fileSystem.ts`.
- Produces:
  - `interface SafEntry { uri: string; name: string; directory: boolean; mimeType: string; size: number; lastModified: number }`
  - `interface SafNative { listChildren(treeUri, uri): Promise<SafEntry[]>; createDocument(treeUri, parentUri, name, directory): Promise<SafEntry>; deleteDocument(treeUri, uri): Promise<void>; openWriter(treeUri, uri): Promise<number>; writeChunk(writerId, bytes: Uint8Array): Promise<void>; closeWriter(writerId): Promise<void>; abortWriter(writerId): Promise<void>; readFile(uri): Promise<Blob> }`
  - `SAF_CHUNK_BYTES = 1048576`
  - `class SafDirectoryHandle(native: SafNative, treeUri: string, entry: SafEntry)` with `invalidate()`
  - `class SafFileHandle(native: SafNative, parent: SafDirectoryHandle, entry: SafEntry)`
  - `class SafWritable(native: SafNative, writerId: number, onClosed: () => void)` with `write(data)`, `close()` and `abort()`

- [ ] **Step 1: Write the failing tests**

`test/androidSafHandles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SAF_CHUNK_BYTES, SafDirectoryHandle, SafWritable, type SafEntry, type SafNative } from '../src/platform/android/safHandles';

interface Node { entry: SafEntry; parent: string | null; data: Uint8Array }

function makeFake() {
  const nodes = new Map<string, Node>();
  const writers = new Map<number, { uri: string; parts: Uint8Array[] }>();
  const chunkSizes: number[] = [];
  let nextWriter = 1;
  let listCalls = 0;

  const add = (parent: string | null, name: string, directory: boolean, text = ''): SafEntry => {
    const uri = parent ? `${parent}/${name}` : name;
    const data = new TextEncoder().encode(text);
    const entry: SafEntry = {
      uri, name, directory,
      mimeType: directory ? 'vnd.android.document/directory' : 'application/json',
      size: data.byteLength, lastModified: 1,
    };
    nodes.set(uri, { entry, parent, data });
    return entry;
  };

  const native: SafNative = {
    async listChildren(_tree, uri) {
      listCalls++;
      return [...nodes.values()].filter(node => node.parent === uri).map(node => node.entry);
    },
    async createDocument(_tree, parentUri, name, directory) { return add(parentUri, name, directory); },
    async deleteDocument(_tree, uri) {
      for (const key of [...nodes.keys()]) if (key === uri || key.startsWith(`${uri}/`)) nodes.delete(key);
    },
    async openWriter(_tree, uri) {
      const id = nextWriter++;
      writers.set(id, { uri, parts: [] });
      return id;
    },
    async writeChunk(id, bytes) {
      chunkSizes.push(bytes.byteLength);
      writers.get(id)!.parts.push(bytes.slice());
    },
    async closeWriter(id) {
      const writer = writers.get(id)!;
      const total = writer.parts.reduce((sum, part) => sum + part.byteLength, 0);
      const data = new Uint8Array(total);
      let offset = 0;
      for (const part of writer.parts) { data.set(part, offset); offset += part.byteLength; }
      nodes.get(writer.uri)!.data = data;
      writers.delete(id);
    },
    async abortWriter(id) { writers.delete(id); },
    async readFile(uri) { return new Blob([nodes.get(uri)!.data]); },
  };

  const root = add(null, 'root', true);
  add('root', 'a.json', false, '{"a":1}');
  add('root', 'media', true);
  add('root/media', 'p.jpg', false, 'jpg');
  return { native, nodes, writers, chunkSizes, root, listCalls: () => listCalls };
}

async function names(dir: SafDirectoryHandle): Promise<string[]> {
  const result: string[] = [];
  for await (const [name] of dir.entries()) result.push(name);
  return result.sort();
}

describe('SafDirectoryHandle', () => {
  it('lists children once and reuses the cache', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    expect(await names(dir)).toEqual(['a.json', 'media']);
    expect(await names(dir)).toEqual(['a.json', 'media']);
    expect(fake.listCalls()).toBe(1);
  });

  it('returns typed child handles', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    const kinds: Record<string, string> = {};
    for await (const [name, handle] of dir.entries()) kinds[name] = handle.kind;
    expect(kinds).toEqual({ 'a.json': 'file', media: 'directory' });
    const media = await dir.getDirectoryHandle('media');
    expect(await names(media)).toEqual(['p.jpg']);
  });

  it('reads a file as a File with name and bytes', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    const file = await (await dir.getFileHandle('a.json')).getFile();
    expect(file.name).toBe('a.json');
    expect(file.type).toBe('application/json');
    expect(await file.text()).toBe('{"a":1}');
  });

  it('rejects missing names and kind mismatches', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await expect(dir.getFileHandle('missing.json')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(dir.getDirectoryHandle('a.json')).rejects.toMatchObject({ name: 'TypeMismatchError' });
    await expect(dir.getFileHandle('media')).rejects.toMatchObject({ name: 'TypeMismatchError' });
    await expect(dir.getFileHandle('../x')).rejects.toBeInstanceOf(TypeError);
  });

  it('creates a file and refreshes the listing', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await names(dir);
    const created = await dir.getFileHandle('new.overlay.json', { create: true });
    expect(created.name).toBe('new.overlay.json');
    expect(await names(dir)).toEqual(['a.json', 'media', 'new.overlay.json']);
  });

  it('refuses to remove a non-empty directory without recursive', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await expect(dir.removeEntry('media')).rejects.toMatchObject({ name: 'InvalidModificationError' });
    await dir.removeEntry('media', { recursive: true });
    expect(await names(dir)).toEqual(['a.json']);
    expect(fake.nodes.has('root/media/p.jpg')).toBe(false);
  });

  it('reports granted permissions', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await expect(dir.queryPermission()).resolves.toBe('granted');
    await expect(dir.requestPermission()).resolves.toBe('granted');
  });
});

describe('SafWritable', () => {
  it('writes text and replaces the file on close', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    const writable = await (await dir.getFileHandle('a.json')).createWritable();
    await writable.write('{"b":2}');
    await writable.close();
    expect(new TextDecoder().decode(fake.nodes.get('root/a.json')!.data)).toBe('{"b":2}');
  });

  it('splits large buffers and blobs into 1 MB chunks', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    const writable = new SafWritable(fake.native, writerId, () => {});
    await writable.write(new Uint8Array(SAF_CHUNK_BYTES * 2 + 5));
    await writable.write(new Blob([new Uint8Array(SAF_CHUNK_BYTES + 1)]));
    await writable.close();
    expect(fake.chunkSizes).toEqual([SAF_CHUNK_BYTES, SAF_CHUNK_BYTES, 5, SAF_CHUNK_BYTES, 1]);
    expect(fake.nodes.get('root/a.json')!.data.byteLength).toBe(SAF_CHUNK_BYTES * 3 + 6);
  });

  it('accepts the write-command object form', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    const writable = new SafWritable(fake.native, writerId, () => {});
    await writable.write({ type: 'write', data: 'xy' });
    await writable.close();
    expect(new TextDecoder().decode(fake.nodes.get('root/a.json')!.data)).toBe('xy');
  });

  it('rejects writes after close and calls onClosed once', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    let closed = 0;
    const writable = new SafWritable(fake.native, writerId, () => { closed++; });
    await writable.close();
    await expect(writable.write('late')).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(closed).toBe(1);
  });

  it('aborts without replacing the file', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    const writable = new SafWritable(fake.native, writerId, () => {});
    await writable.write('partial');
    await writable.abort();
    expect(fake.writers.size).toBe(0);
    expect(new TextDecoder().decode(fake.nodes.get('root/a.json')!.data)).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/androidSafHandles.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement the handles**

`src/platform/android/safHandles.ts`:

```ts
import type { ReadableEntryHandle, WritableDirectoryHandle, WritableFileHandle } from '../../types/fileSystem';

/** One document as the Android Storage Access Framework reports it. */
export interface SafEntry {
  uri: string;
  name: string;
  directory: boolean;
  mimeType: string;
  size: number;
  lastModified: number;
}

/** Native operations the handles need. Tests pass an in-memory version. */
export interface SafNative {
  listChildren(treeUri: string, uri: string): Promise<SafEntry[]>;
  createDocument(treeUri: string, parentUri: string, name: string, directory: boolean): Promise<SafEntry>;
  deleteDocument(treeUri: string, uri: string): Promise<void>;
  openWriter(treeUri: string, uri: string): Promise<number>;
  writeChunk(writerId: number, bytes: Uint8Array): Promise<void>;
  closeWriter(writerId: number): Promise<void>;
  abortWriter(writerId: number): Promise<void>;
  readFile(uri: string): Promise<Blob>;
}

export const SAF_CHUNK_BYTES = 1024 * 1024;

type WriteData = string | Blob | ArrayBuffer | ArrayBufferView;
type WriteInput = WriteData | { type: 'write'; data: WriteData };

function assertValidName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Invalid name: ${name}`);
  }
}

function isWriteCommand(input: WriteInput): input is { type: 'write'; data: WriteData } {
  return typeof input === 'object' && input !== null && !(input instanceof Blob)
    && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer)
    && (input as { type?: unknown }).type === 'write';
}

async function* chunksOf(data: WriteData): AsyncGenerator<Uint8Array> {
  if (data instanceof Blob) {
    for (let offset = 0; offset < data.size; offset += SAF_CHUNK_BYTES) {
      yield new Uint8Array(await data.slice(offset, offset + SAF_CHUNK_BYTES).arrayBuffer());
    }
    return;
  }
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += SAF_CHUNK_BYTES) {
    yield bytes.subarray(offset, offset + SAF_CHUNK_BYTES);
  }
}

/** The subset of FileSystemWritableFileStream the app uses: write, close, abort. */
export class SafWritable {
  private open = true;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly native: SafNative,
    private readonly writerId: number,
    private readonly onClosed: () => void,
  ) {}

  write(input: WriteInput): Promise<void> {
    return this.enqueue(async () => {
      const data = isWriteCommand(input) ? input.data : input;
      for await (const chunk of chunksOf(data)) {
        await this.native.writeChunk(this.writerId, chunk);
      }
    });
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      this.open = false;
      await this.native.closeWriter(this.writerId);
      this.onClosed();
    });
  }

  abort(): Promise<void> {
    return this.enqueue(async () => {
      this.open = false;
      await this.native.abortWriter(this.writerId);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => {
      if (!this.open) throw new DOMException('The writer is closed.', 'InvalidStateError');
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export class SafFileHandle implements WritableFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;

  constructor(
    private readonly native: SafNative,
    private readonly parent: SafDirectoryHandle,
    readonly entry: SafEntry,
  ) {
    this.name = entry.name;
  }

  async getFile(): Promise<File> {
    const blob = await this.native.readFile(this.entry.uri);
    const type = this.entry.mimeType === 'application/octet-stream' ? '' : this.entry.mimeType;
    return new File([blob], this.name, { type, lastModified: this.entry.lastModified });
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const writerId = await this.native.openWriter(this.parent.treeUri, this.entry.uri);
    const writable = new SafWritable(this.native, writerId, () => this.parent.invalidate());
    return writable as unknown as FileSystemWritableFileStream;
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof SafFileHandle && other.entry.uri === this.entry.uri;
  }
}

export class SafDirectoryHandle implements WritableDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  private children: Promise<Map<string, SafEntry>> | null = null;

  constructor(
    private readonly native: SafNative,
    readonly treeUri: string,
    readonly entry: SafEntry,
  ) {
    this.name = entry.name;
  }

  invalidate(): void {
    this.children = null;
  }

  async *entries(): AsyncIterableIterator<[string, ReadableEntryHandle]> {
    for (const child of (await this.loadChildren()).values()) {
      yield [child.name, this.wrap(child)];
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const child of (await this.loadChildren()).values()) yield child.name;
  }

  async *values(): AsyncIterableIterator<ReadableEntryHandle> {
    for (const child of (await this.loadChildren()).values()) yield this.wrap(child);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, ReadableEntryHandle]> {
    return this.entries();
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<SafDirectoryHandle> {
    const entry = await this.child(name, true, options.create === true);
    return new SafDirectoryHandle(this.native, this.treeUri, entry);
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<SafFileHandle> {
    const entry = await this.child(name, false, options.create === true);
    return new SafFileHandle(this.native, this, entry);
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    assertValidName(name);
    const existing = (await this.loadChildren()).get(name);
    if (!existing) throw new DOMException(`${name} was not found.`, 'NotFoundError');
    if (existing.directory && !options.recursive) {
      const grandchildren = await this.native.listChildren(this.treeUri, existing.uri);
      if (grandchildren.length > 0) throw new DOMException(`${name} is not empty.`, 'InvalidModificationError');
    }
    await this.native.deleteDocument(this.treeUri, existing.uri);
    this.invalidate();
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof SafDirectoryHandle && other.entry.uri === this.entry.uri;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }

  private async child(name: string, directory: boolean, create: boolean): Promise<SafEntry> {
    assertValidName(name);
    const existing = (await this.loadChildren()).get(name);
    if (existing) {
      if (existing.directory !== directory) {
        throw new DOMException(`${name} is a ${existing.directory ? 'directory' : 'file'}.`, 'TypeMismatchError');
      }
      return existing;
    }
    if (!create) throw new DOMException(`${name} was not found.`, 'NotFoundError');
    const created = await this.native.createDocument(this.treeUri, this.entry.uri, name, directory);
    this.invalidate();
    return created;
  }

  private loadChildren(): Promise<Map<string, SafEntry>> {
    if (!this.children) {
      const loading = this.native.listChildren(this.treeUri, this.entry.uri)
        .then(entries => new Map(entries.map(child => [child.name, child] as const)));
      loading.catch(() => {
        if (this.children === loading) this.children = null;
      });
      this.children = loading;
    }
    return this.children;
  }

  private wrap(child: SafEntry): SafDirectoryHandle | SafFileHandle {
    return child.directory
      ? new SafDirectoryHandle(this.native, this.treeUri, child)
      : new SafFileHandle(this.native, this, child);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/androidSafHandles.test.ts`
Expected: PASS, 12 tests.

Run: `npx tsc -b`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/platform/android/safHandles.ts test/androidSafHandles.test.ts
git commit -m "feat(android): add SAF-backed directory and file handles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Android native client and directory picker (model: sonnet)

**Files:**
- Create: `src/platform/android/safNative.ts`
- Modify: `src/platform/android/install.ts` (whole file)
- Test: `test/androidSafNative.test.ts`

**Interfaces:**
- Consumes: `NativeBridge` and `connectNativeBridge` (Task 3); `SafEntry`, `SafNative` and `SafDirectoryHandle` (Task 4).
- Produces:
  - `interface PickedTree extends SafEntry { treeUri: string }`
  - `interface AndroidNative extends SafNative { pickDirectory(mode: 'read' | 'readwrite'): Promise<PickedTree>; beginOutput(kind: 'saveAs' | 'open', name: string, mimeType: string): Promise<number> }`
  - `encodeSafPath(uri: string): string`, which returns base64url without padding
  - `createAndroidNative(bridge: NativeBridge, fetchImpl?: typeof fetch): AndroidNative`
  - `createDirectoryPicker(native: AndroidNative): (options?: { mode?: 'read' | 'readwrite' }) => Promise<SafDirectoryHandle>`
  - `installAndroidPlatform(win?: Window): Promise<void>`
- Native methods used (Task 9 implements them): `pickDirectory`, `listChildren`, `createDocument`, `deleteDocument`, `openWriter`, `beginOutput`, `writeChunk`, `closeWriter`, `abortWriter`.

- [ ] **Step 1: Write the failing tests**

`test/androidSafNative.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { NativeBridge } from '../src/platform/android/nativeBridge';
import { createAndroidNative, encodeSafPath } from '../src/platform/android/safNative';
import { createDirectoryPicker } from '../src/platform/android/install';
import { SafDirectoryHandle } from '../src/platform/android/safHandles';

function fakeBridge(results: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args: Record<string, unknown>; timeout: number | null | undefined }> = [];
  const bridge: NativeBridge = {
    binary: true,
    async call<T>(method: string, args: Record<string, unknown> = {}, timeout?: number | null) {
      calls.push({ method, args, timeout });
      return results[method] as T;
    },
    sendChunk: vi.fn(async () => {}),
  };
  return { bridge, calls };
}

function decodeSafPath(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

describe('encodeSafPath', () => {
  it('round-trips document URIs with escapes and Unicode', () => {
    const uri = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2Ffb/document/primary%3ADownload%2Ffb%2FTôi.json';
    const encoded = encodeSafPath(uri);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSafPath(encoded)).toBe(uri);
  });
});

describe('createAndroidNative', () => {
  it('waits indefinitely for pickers and uses the default timeout otherwise', async () => {
    const { bridge, calls } = fakeBridge({ pickDirectory: { treeUri: 't' }, beginOutput: { writerId: 4 }, listChildren: { entries: [] } });
    const native = createAndroidNative(bridge);
    await native.pickDirectory('readwrite');
    await native.beginOutput('saveAs', 'a.zip', 'application/zip');
    await native.beginOutput('open', 'a.json', 'application/json');
    await native.listChildren('t', 'u');
    expect(calls.map(call => [call.method, call.timeout])).toEqual([
      ['pickDirectory', null],
      ['beginOutput', null],
      ['beginOutput', undefined],
      ['listChildren', undefined],
    ]);
  });

  it('unwraps entries and writer ids', async () => {
    const entry = { uri: 'u', name: 'a', directory: false, mimeType: 'text/plain', size: 1, lastModified: 1 };
    const { bridge } = fakeBridge({ listChildren: { entries: [entry] }, openWriter: { writerId: 9 } });
    const native = createAndroidNative(bridge);
    await expect(native.listChildren('t', 'u')).resolves.toEqual([entry]);
    await expect(native.openWriter('t', 'u')).resolves.toBe(9);
  });

  it('reads files from the /saf/ path and maps HTTP errors', async () => {
    const { bridge } = fakeBridge();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(encodeSafPath('denied'))) return new Response('', { status: 403 });
      if (path.endsWith(encodeSafPath('missing'))) return new Response('', { status: 404 });
      return new Response('bytes', { status: 200 });
    });
    const native = createAndroidNative(bridge, fetchImpl as unknown as typeof fetch);
    await expect((await native.readFile('ok')).text()).resolves.toBe('bytes');
    expect(fetchImpl).toHaveBeenCalledWith(`/saf/${encodeSafPath('ok')}`);
    await expect(native.readFile('denied')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(native.readFile('missing')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('createDirectoryPicker', () => {
  it('returns a SAF directory handle rooted at the picked tree', async () => {
    const picked = { treeUri: 'tree', uri: 'tree/document/root', name: 'fb', directory: true, mimeType: 'vnd.android.document/directory', size: 0, lastModified: 0 };
    const { bridge, calls } = fakeBridge({ pickDirectory: picked });
    const handle = await createDirectoryPicker(createAndroidNative(bridge))({ mode: 'readwrite' });
    expect(handle).toBeInstanceOf(SafDirectoryHandle);
    expect(handle.name).toBe('fb');
    expect(handle.treeUri).toBe('tree');
    expect(calls[0]).toMatchObject({ method: 'pickDirectory', args: { mode: 'readwrite' } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/androidSafNative.test.ts`
Expected: FAIL, because `safNative` cannot be resolved.

- [ ] **Step 3: Implement the native client**

`src/platform/android/safNative.ts`:

```ts
import type { NativeBridge } from './nativeBridge';
import type { SafEntry, SafNative } from './safHandles';

export interface PickedTree extends SafEntry {
  treeUri: string;
}

export interface AndroidNative extends SafNative {
  pickDirectory(mode: 'read' | 'readwrite'): Promise<PickedTree>;
  /** Opens a writer for a save-as document (system picker) or an external-view cache file. */
  beginOutput(kind: 'saveAs' | 'open', name: string, mimeType: string): Promise<number>;
}

/** base64url without padding, so the URI survives as one path segment. */
export function encodeSafPath(uri: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(uri)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createAndroidNative(bridge: NativeBridge, fetchImpl: typeof fetch = (...args) => fetch(...args)): AndroidNative {
  return {
    pickDirectory: mode => bridge.call<PickedTree>('pickDirectory', { mode }, null),
    listChildren: async (treeUri, uri) => (await bridge.call<{ entries: SafEntry[] }>('listChildren', { treeUri, uri })).entries,
    createDocument: (treeUri, parentUri, name, directory) => bridge.call<SafEntry>('createDocument', { treeUri, parentUri, name, directory }),
    deleteDocument: async (treeUri, uri) => {
      await bridge.call('deleteDocument', { treeUri, uri });
    },
    openWriter: async (treeUri, uri) => (await bridge.call<{ writerId: number }>('openWriter', { treeUri, uri })).writerId,
    beginOutput: async (kind, name, mimeType) => (await bridge.call<{ writerId: number }>(
      'beginOutput', { kind, name, mimeType }, kind === 'saveAs' ? null : undefined,
    )).writerId,
    writeChunk: (writerId, bytes) => bridge.sendChunk(writerId, bytes),
    closeWriter: async writerId => {
      await bridge.call('closeWriter', { writerId });
    },
    abortWriter: async writerId => {
      await bridge.call('abortWriter', { writerId });
    },
    readFile: async uri => {
      const response = await fetchImpl(`/saf/${encodeSafPath(uri)}`);
      if (response.status === 403) throw new DOMException('Access to the file was denied.', 'NotAllowedError');
      if (response.status === 404) throw new DOMException('The file was not found.', 'NotFoundError');
      if (!response.ok) throw new DOMException(`The file could not be read (${response.status}).`, 'NotReadableError');
      return response.blob();
    },
  };
}
```

- [ ] **Step 4: Implement the picker install**

Replace `src/platform/android/install.ts` with:

```ts
import { connectNativeBridge, type NativePort } from './nativeBridge';
import { SafDirectoryHandle } from './safHandles';
import { createAndroidNative, type AndroidNative } from './safNative';

declare global {
  interface Window {
    fbmae?: NativePort;
  }
}

export function createDirectoryPicker(native: AndroidNative) {
  return async (options?: { mode?: 'read' | 'readwrite' }): Promise<SafDirectoryHandle> => {
    const picked = await native.pickDirectory(options?.mode ?? 'read');
    return new SafDirectoryHandle(native, picked.treeUri, picked);
  };
}

export async function installAndroidPlatform(win: Window = window): Promise<void> {
  const port = win.fbmae;
  if (!port) throw new Error('The Android bridge is unavailable.');
  const native = createAndroidNative(await connectNativeBridge(port));
  win.showDirectoryPicker = createDirectoryPicker(native) as unknown as Window['showDirectoryPicker'];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/androidSafNative.test.ts`
Expected: PASS, 5 tests.

Run: `npx tsc -b && npm run lint`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/platform/android/safNative.ts src/platform/android/install.ts test/androidSafNative.test.ts
git commit -m "feat(android): open folders through the SAF picker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Download and external-open hooks (model: sonnet)

**Files:**
- Create: `src/platform/android/androidDownloads.ts`
- Modify: `src/platform/android/install.ts`
- Test: `test/androidDownloads.test.ts`

**Interfaces:**
- Consumes: `AndroidNative.beginOutput` (Task 5); `SafWritable` (Task 4).
- Produces:
  - `interface OutputSink { saveAs(name: string, blob: Blob): Promise<void>; openExternally(name: string, blob: Blob): Promise<void> }`
  - `nameForBlob(blob: Blob): string`
  - `installDownloadHooks(win: Window, sink: OutputSink, report?: (error: unknown) => void): void`
  - `createOutputSink(native: AndroidNative): OutputSink`

- [ ] **Step 1: Write the failing tests**

`test/androidDownloads.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDownloadHooks, nameForBlob, type OutputSink } from '../src/platform/android/androidDownloads';

const sink = {
  saveAs: vi.fn<OutputSink['saveAs']>(async () => {}),
  openExternally: vi.fn<OutputSink['openExternally']>(async () => {}),
};
const report = vi.fn();
const originalOpen = vi.fn(() => null);
let urlCounter = 0;

beforeAll(() => {
  window.URL.createObjectURL = () => `blob:https://appassets.androidplatform.net/${++urlCounter}`;
  window.URL.revokeObjectURL = () => {};
  window.open = originalOpen as unknown as typeof window.open;
  installDownloadHooks(window, sink, report);
});

beforeEach(() => {
  sink.saveAs.mockClear();
  sink.openExternally.mockClear();
  report.mockClear();
  originalOpen.mockClear();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('installDownloadHooks', () => {
  it('saves a detached download anchor even if the URL is revoked right away', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Chat-Attachments.zip';
    anchor.click();
    window.URL.revokeObjectURL(url);
    await settle();
    expect(sink.saveAs).toHaveBeenCalledWith('Chat-Attachments.zip', blob);
  });

  it('intercepts a user tap on a rendered download link', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    const anchor = document.createElement('a');
    anchor.href = window.URL.createObjectURL(blob);
    anchor.setAttribute('download', 'photo.jpg');
    const span = document.createElement('span');
    anchor.appendChild(span);
    document.body.appendChild(anchor);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    span.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(sink.saveAs).toHaveBeenCalledWith('photo.jpg', blob);
    anchor.remove();
  });

  it('leaves anchors without a blob download alone', async () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/';
    document.body.appendChild(anchor);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    await settle();
    expect(sink.saveAs).not.toHaveBeenCalled();
    anchor.remove();
  });

  it('opens a blob URL externally', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    expect(window.open(window.URL.createObjectURL(blob), '_blank')).toBeNull();
    await settle();
    expect(sink.openExternally).toHaveBeenCalledWith('attachment.json', blob);
    expect(originalOpen).not.toHaveBeenCalled();
  });

  it('supports the about:blank tab followed by a location assignment', async () => {
    const blob = new Blob(['x'], { type: 'video/mp4' });
    const tab = window.open('about:blank', '_blank')!;
    tab.opener = null;
    tab.location.href = window.URL.createObjectURL(blob);
    await settle();
    expect(sink.openExternally).toHaveBeenCalledWith('attachment.mp4', blob);
    tab.close();
  });

  it('passes other URLs to the original window.open', () => {
    window.open('https://example.com/', '_blank', 'noopener');
    expect(originalOpen).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener');
  });

  it('reports failures except cancelled pickers', async () => {
    sink.saveAs.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    sink.saveAs.mockRejectedValueOnce(new Error('disk full'));
    for (const name of ['a.txt', 'b.txt']) {
      const anchor = document.createElement('a');
      anchor.href = window.URL.createObjectURL(new Blob(['t']));
      anchor.download = name;
      anchor.click();
    }
    await settle();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({ message: 'disk full' });
  });
});

describe('nameForBlob', () => {
  it('uses an extension for known types', () => {
    expect(nameForBlob(new Blob([], { type: 'image/png' }))).toBe('attachment.png');
    expect(nameForBlob(new Blob([]))).toBe('attachment');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/androidDownloads.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement the hooks**

`src/platform/android/androidDownloads.ts`:

```ts
import { SafWritable } from './safHandles';
import type { AndroidNative } from './safNative';

export interface OutputSink {
  saveAs(name: string, blob: Blob): Promise<void>;
  openExternally(name: string, blob: Blob): Promise<void>;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/zip': 'zip',
  'application/pdf': 'pdf',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
};

export function nameForBlob(blob: Blob): string {
  const extension = MIME_EXTENSIONS[blob.type];
  return extension ? `attachment.${extension}` : 'attachment';
}

// Duck-typed so it works across realms (tests) and excludes MediaSource.
function isBlob(value: unknown): value is Blob {
  return typeof value === 'object' && value !== null
    && typeof (value as Blob).slice === 'function' && typeof (value as Blob).size === 'number';
}

/**
 * WebView ignores `<a download>` and cannot open blob URLs in a new tab.
 * Route both through native save-as and external-view outputs.
 */
export function installDownloadHooks(
  win: Window,
  sink: OutputSink,
  report: (error: unknown) => void = error => console.error('[Android] Output failed:', error),
): void {
  // The app revokes blob URLs about a second after clicking, so keep the Blob
  // reachable by URL until then and look it up synchronously.
  const blobs = new Map<string, Blob>();
  const urlApi = win.URL;
  const originalCreate = urlApi.createObjectURL.bind(urlApi);
  const originalRevoke = urlApi.revokeObjectURL.bind(urlApi);
  urlApi.createObjectURL = (object: Blob | MediaSource) => {
    const url = originalCreate(object);
    if (isBlob(object)) blobs.set(url, object);
    return url;
  };
  urlApi.revokeObjectURL = (url: string) => {
    blobs.delete(url);
    originalRevoke(url);
  };

  const deliver = (task: Promise<void>) => {
    void task.catch(error => {
      if ((error as { name?: string } | null)?.name !== 'AbortError') report(error);
    });
  };

  const handleAnchor = (anchor: HTMLAnchorElement): boolean => {
    if (!anchor.hasAttribute('download')) return false;
    const blob = blobs.get(anchor.href);
    if (!blob) return false;
    deliver(sink.saveAs(anchor.download || nameForBlob(blob), blob));
    return true;
  };

  const anchorPrototype = win.HTMLAnchorElement.prototype;
  const originalClick = anchorPrototype.click;
  anchorPrototype.click = function click(this: HTMLAnchorElement) {
    if (!handleAnchor(this)) originalClick.call(this);
  };

  win.document.addEventListener('click', event => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a[download]') as HTMLAnchorElement | null;
    if (anchor && handleAnchor(anchor)) event.preventDefault();
  }, true);

  const openBlob = (url: string): boolean => {
    const blob = blobs.get(url);
    if (!blob) return false;
    deliver(sink.openExternally(nameForBlob(blob), blob));
    return true;
  };

  const originalOpen = win.open.bind(win);
  win.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url === undefined ? '' : String(url);
    if (href === 'about:blank') return createPendingTab(openBlob) as unknown as Window;
    if (openBlob(href)) return null;
    return originalOpen(url, target, features);
  }) as typeof win.open;
}

/** Stands in for the tab the app opens before its blob URL is ready. */
function createPendingTab(openBlob: (url: string) => boolean) {
  return {
    opener: null as unknown,
    closed: false,
    close() {
      this.closed = true;
    },
    location: {
      get href() {
        return 'about:blank';
      },
      set href(value: string) {
        openBlob(value);
      },
    },
  };
}

export function createOutputSink(native: AndroidNative): OutputSink {
  const write = async (kind: 'saveAs' | 'open', name: string, blob: Blob) => {
    const writerId = await native.beginOutput(kind, name, blob.type || 'application/octet-stream');
    const writable = new SafWritable(native, writerId, () => {});
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  };
  return {
    saveAs: (name, blob) => write('saveAs', name, blob),
    openExternally: (name, blob) => write('open', name, blob),
  };
}
```

- [ ] **Step 4: Wire the hooks into the install**

In `src/platform/android/install.ts`:
- add `import { createOutputSink, installDownloadHooks } from './androidDownloads';`;
- in `installAndroidPlatform`, after `win.showDirectoryPicker = …`, add:

```ts
  installDownloadHooks(win, createOutputSink(native));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/androidDownloads.test.ts test/androidSafNative.test.ts`
Expected: PASS, 8 + 5 tests.

Run: `npm test && npx tsc -b && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/platform/android/androidDownloads.ts src/platform/android/install.ts test/androidDownloads.test.ts
git commit -m "feat(android): route downloads and blob tabs to native outputs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Android shell project and build script (model: sonnet)

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/.gitignore`
- Create: `android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/gradle-wrapper.jar`, `android/gradle/wrapper/gradle-wrapper.properties` (copied from DGallery, Gradle 9.8.2)
- Create: `android/app/build.gradle.kts`, `android/app/proguard-rules.pro`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/values/strings.xml`, `res/values/themes.xml`, `res/mipmap-xxxhdpi/ic_launcher.png`
- Create: `android/app/src/main/java/app/fbmae/AssetMime.kt`, `AppAssetsHandler.kt`, `MainActivity.kt`
- Create: `scripts/build-android.mjs`
- Modify: `package.json` (`scripts`)
- Create, not committed: `android/local.properties`
- Test: `android/app/src/test/java/app/fbmae/AssetMimeTest.kt`

**Interfaces:**
- Produces:
  - `AssetMime.forPath(path: String): String`, `AssetMime.encodingFor(mimeType: String): String?`, `AssetMime.assetPathFor(path: String): String?`
  - `AppAssetsHandler(assets: AssetManager)`
  - `MainActivity` with `APP_URL = "https://appassets.androidplatform.net/index.html"`
  - npm scripts `build:android`, `build:android:release`, `test:android`

- [ ] **Step 1: Check F: and the stale lock**

```powershell
Test-Path F:\
Get-Content F:\Project\FB-Messages-Archive-Explorer\gradle.lock -ErrorAction SilentlyContinue
```

If F: is missing, stop and ask the owner. The lock written at 14:46 on 2026-11-11 belongs to the abandoned Capacitor attempt. Ask the owner before deleting it; do not delete it unasked.

- [ ] **Step 2: Copy the Gradle wrapper**

```bash
mkdir -p android/gradle/wrapper android/app/src/main/java/app/fbmae android/app/src/test/java/app/fbmae android/app/src/main/res/values android/app/src/main/res/mipmap-xxxhdpi android/app/src/main/res/xml
cp D:/Personal/Coding/DGallery/gradlew D:/Personal/Coding/DGallery/gradlew.bat android/
cp D:/Personal/Coding/DGallery/gradle/wrapper/gradle-wrapper.jar D:/Personal/Coding/DGallery/gradle/wrapper/gradle-wrapper.properties android/gradle/wrapper/
cp public/pwa-192x192.png android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
```

Expected: `android/gradle/wrapper/gradle-wrapper.properties` contains `gradle-9.8.2-bin.zip`.

- [ ] **Step 3: Write the Gradle files**

`android/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "fbmae-android"
include(":app")
```

`android/build.gradle.kts`:

```kotlin
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
```

`android/gradle.properties`:

```properties
org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
org.gradle.caching=true
org.gradle.configuration-cache=true
android.useAndroidX=true
android.nonTransitiveRClass=true
```

`android/.gitignore`:

```
local.properties
keystore.properties
*.jks
.gradle/
build/
```

`android/app/build.gradle.kts`:

```kotlin
import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing reads keystore.properties (never committed). Without it, the
// release APK is signed with the debug key so it can still be sideloaded.
val keystoreFile = rootProject.file("keystore.properties")
val keystore = Properties().apply {
    if (keystoreFile.isFile) keystoreFile.inputStream().use { load(it) }
}
val webDir = rootProject.extra["fbmaeWebDir"] as String

android {
    namespace = "app.fbmae"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.fbmae"
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (keystoreFile.isFile) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets.getByName("main").assets.directories.add(webDir)

    packaging {
        resources.excludes += setOf("META-INF/*.version", "META-INF/*.kotlin_module", "kotlin/**", "DebugProbesKt.bin")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    testImplementation("junit:junit:4.13.2")
}
```

`android/app/proguard-rules.pro`:

```
# No reflection or JavascriptInterface is used; the default optimize rules are enough.
```

`android/local.properties` (gitignored; create it, do not commit it):

```properties
sdk.dir=C\:\\Users\\LENOVO\\AppData\\Local\\Android\\Sdk
fbmae.outputRoot=F\:/Project/FB-Messages-Archive-Explorer
```

- [ ] **Step 4: Write the failing asset tests**

`android/app/src/test/java/app/fbmae/AssetMimeTest.kt`:

```kotlin
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
```

- [ ] **Step 5: Implement the asset rules, asset handler and Activity**

`android/app/src/main/java/app/fbmae/AssetMime.kt`:

```kotlin
package app.fbmae

/** MIME and path rules for the bundled web app. Module scripts need an exact JS MIME type. */
object AssetMime {
    private val types = mapOf(
        "html" to "text/html",
        "js" to "text/javascript",
        "mjs" to "text/javascript",
        "css" to "text/css",
        "json" to "application/json",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "ico" to "image/x-icon",
        "webmanifest" to "application/manifest+json",
        "woff2" to "font/woff2",
        "wasm" to "application/wasm",
        "txt" to "text/plain",
    )

    fun forPath(path: String): String =
        types[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"

    fun encodingFor(mimeType: String): String? =
        if (mimeType.startsWith("text/") || mimeType.endsWith("json") || mimeType.endsWith("xml")) "utf-8" else null

    /** Maps a request path to an asset path, or null when it would leave the asset root. */
    fun assetPathFor(path: String): String? {
        val clean = path.substringBefore('?').substringBefore('#').trimStart('/')
        if (clean.split('/').any { it == ".." }) return null
        return clean.ifEmpty { "index.html" }
    }
}
```

`android/app/src/main/java/app/fbmae/AppAssetsHandler.kt`:

```kotlin
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
```

`android/app/src/main/java/app/fbmae/MainActivity.kt` (Task 9 replaces it with the bridged version):

```kotlin
package app.fbmae

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.os.Bundle
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
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var container: FrameLayout
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        container.addView(webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView.loadUrl(APP_URL)
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
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
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
    }
}
```

- [ ] **Step 6: Write the manifest and resources**

`android/app/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="false"
        android:enableOnBackInvokedCallback="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">
        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboard|keyboardHidden|navigation|uiMode|density"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

`android/app/src/main/res/values/strings.xml`:

```xml
<resources>
    <string name="app_name">FB Archive</string>
    <string name="reloaded">Đã tải lại app. Hãy mở lại thư mục.</string>
    <string name="no_viewer">Không có app nào mở được mục này.</string>
    <string name="webview_too_old">WebView quá cũ. Hãy cập nhật Android System WebView.</string>
</resources>
```

`android/app/src/main/res/values/themes.xml`:

```xml
<resources>
    <style name="AppTheme" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
    </style>
</resources>
```

- [ ] **Step 7: Write the build script**

`scripts/build-android.mjs`:

```js
#!/usr/bin/env node
// Builds the Android app under the project build lock:
// web bundle (android mode) → Gradle task → permission gate for APK tasks.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const androidDir = join(root, 'android');
const task = process.argv[2] ?? 'assembleDebug';
const skipWeb = task.startsWith('test');
const outputRoot = readOutputRoot();

if (outputRoot && !existsSync(parse(outputRoot).root)) fail(`${parse(outputRoot).root} is not mounted. Ask the owner before building.`);

const lockFile = outputRoot ? join(outputRoot, 'gradle.lock') : null;
if (lockFile && existsSync(lockFile)) fail(`Build lock held: ${readFileSync(lockFile, 'utf8').trim()} (${lockFile})`);
if (lockFile) writeFileSync(lockFile, `FB-MAE ${task} ${new Date().toTimeString().slice(0, 5)}\n`);

try {
  const env = { ...process.env, ...(outputRoot ? { FBMAE_OUTPUT_ROOT: outputRoot } : {}) };
  if (!skipWeb) run('npm', ['run', 'build:web:android'], root, env);
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const cacheArgs = outputRoot ? ['--project-cache-dir', join(outputRoot, '.gradle-project')] : [];
  run(gradlew, [task, ...cacheArgs], androidDir, env);
  if (task.startsWith('assemble')) checkPermissions(task === 'assembleRelease' ? 'release' : 'debug');
} finally {
  if (lockFile) rmSync(lockFile, { force: true });
}

function readOutputRoot() {
  const file = join(androidDir, 'local.properties');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find(text => text.startsWith('fbmae.outputRoot='));
  return line ? line.slice('fbmae.outputRoot='.length).replace(/\\:/g, ':').trim() : null;
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function checkPermissions(variant) {
  const buildRoot = outputRoot ? join(outputRoot, 'android-build', 'app') : join(androidDir, 'app', 'build');
  const apkDir = join(buildRoot, 'outputs', 'apk', variant);
  const apk = readdirSync(apkDir).find(name => name.endsWith('.apk'));
  if (!apk) fail(`No APK in ${apkDir}`);
  const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const buildTools = readdirSync(join(sdk, 'build-tools')).sort().at(-1);
  const aapt2 = join(sdk, 'build-tools', buildTools, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
  const result = spawnSync(aapt2, ['dump', 'permissions', join(apkDir, apk)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`aapt2 failed: ${result.stderr}`);
  if (result.stdout.includes('android.permission.INTERNET')) fail('The APK requests INTERNET; remove it.');
  console.log(`[build-android] ${apk}: no INTERNET permission`);
}

function fail(message) {
  console.error(`[build-android] ${message}`);
  process.exit(1);
}
```

In `package.json` `scripts`, add:

```json
"build:android": "node scripts/build-android.mjs assembleDebug",
"build:android:release": "node scripts/build-android.mjs assembleRelease",
"test:android": "node scripts/build-android.mjs testDebugUnitTest",
```

- [ ] **Step 8: Run the JUnit tests to verify they pass**

Run: `npm run test:android`
Expected: `BUILD SUCCESSFUL`; `AssetMimeTest` has 3 passing tests. The first run downloads `androidx.webkit` 1.18.0.

If AGP rejects `compileSdk = 37` or `assets.directories`, read the error, fix it using the DGallery convention files (`D:\Personal\Coding\DGallery\build-logic\convention\`), and rerun.

- [ ] **Step 9: Build the debug APK**

Run: `npm run build:android`
Expected: `BUILD SUCCESSFUL`, then `[build-android] app-debug.apk: no INTERNET permission`. The APK is in `F:\Project\FB-Messages-Archive-Explorer\android-build\app\outputs\apk\debug\`.

- [ ] **Step 10: Optional S23 smoke test**

Run this only when `D:\Personal\Coding\.s23.lock` is absent; otherwise skip to Task 12.
1. Write the lock: `"FB-MAE smoke HH:MM"`.
2. Install: `adb -s RFCX70GZ85Y install --user 0 -r <apk>`.
3. Launch: `adb -s RFCX70GZ85Y shell am start --user 0 -n app.fbmae.debug/app.fbmae.MainActivity`.
4. Check that the sidebar renders: `adb -s RFCX70GZ85Y exec-out screencap -p > F:\Project\FB-Messages-Archive-Explorer\shots\smoke.png`.
5. Check for module-script MIME errors: `adb -s RFCX70GZ85Y logcat -d -s chromium`.
6. Delete the lock.

- [ ] **Step 11: Commit**

```bash
git add android/settings.gradle.kts android/build.gradle.kts android/gradle.properties android/.gitignore android/gradlew android/gradlew.bat android/gradle android/app scripts/build-android.mjs package.json
git commit -m "build(android): add WebView shell project and build script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Kotlin pure helpers (model: sonnet)

**Files:**
- Create: `android/app/src/main/java/app/fbmae/SafPath.kt`, `TreeGuard.kt`, `WriterRegistry.kt`, `DomErrors.kt`, `ChunkFrames.kt`, `OutputNames.kt`
- Test: `android/app/src/test/java/app/fbmae/PureHelpersTest.kt`

**Interfaces:**
- Produces:
  - `SafPath.decode(path: String): String?`
  - `TreeGuard.isAllowed(documentUri: String, trees: Collection<String>): Boolean`, `TreeGuard.isTreeGranted(treeUri: String, trees: Collection<String>): Boolean`
  - `class WriterRegistry { fun open(stream: OutputStream, onClose: () -> Unit = {}): Int; fun write(id: Int, bytes: ByteArray, offset: Int = 0, length: Int = bytes.size); fun close(id: Int); fun abort(id: Int); fun closeAll() }`
  - `class PickerCancelledException`, `DomErrors.nameFor(error: Throwable): String`
  - `data class ChunkFrame(val requestId: Int, val writerId: Int, val payloadOffset: Int)`, `ChunkFrames.parse(bytes: ByteArray): ChunkFrame?`
  - `OutputNames.sanitize(name: String): String`

- [ ] **Step 1: Write the failing tests**

`android/app/src/test/java/app/fbmae/PureHelpersTest.kt`:

```kotlin
package app.fbmae

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

class PureHelpersTest {
    private val tree = "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Ffb"

    @Test
    fun decodesBase64UrlPaths() {
        val uri = "$tree/document/primary%3ADownload%2Ffb%2FTôi.json"
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(uri.toByteArray(Charsets.UTF_8))
        assertEquals(uri, SafPath.decode(encoded))
        assertNull(SafPath.decode(""))
        assertNull(SafPath.decode("not base64 !"))
    }

    @Test
    fun allowsOnlyDocumentsUnderGrantedTrees() {
        val trees = listOf(tree)
        assertTrue(TreeGuard.isAllowed("$tree/document/primary%3ADownload%2Ffb%2Fa.json", trees))
        assertFalse(TreeGuard.isAllowed("$tree/document/", trees))
        assertFalse(TreeGuard.isAllowed("$tree/document/a/../b", trees))
        assertFalse(TreeGuard.isAllowed("content://other/tree/x/document/y", trees))
        assertFalse(TreeGuard.isAllowed("${tree}2/document/primary%3ADownload%2Ffb2", trees))
        assertTrue(TreeGuard.isTreeGranted(tree, trees))
        assertFalse(TreeGuard.isTreeGranted("$tree/x", trees))
    }

    @Test
    fun writesClosesAndAbortsStreams() {
        val registry = WriterRegistry()
        val out = ByteArrayOutputStream()
        var closed = 0
        val id = registry.open(out) { closed++ }
        registry.write(id, byteArrayOf(9, 1, 2, 3), 1, 3)
        registry.close(id)
        assertArrayEquals(byteArrayOf(1, 2, 3), out.toByteArray())
        assertEquals(1, closed)
        assertThrows(IllegalStateException::class.java) { registry.write(id, byteArrayOf(1)) }

        val aborted = registry.open(ByteArrayOutputStream()) { closed++ }
        registry.abort(aborted)
        assertEquals(1, closed)
        assertThrows(IllegalStateException::class.java) { registry.close(aborted) }
    }

    @Test
    fun mapsExceptionsToDomErrorNames() {
        assertEquals("AbortError", DomErrors.nameFor(PickerCancelledException()))
        assertEquals("NotAllowedError", DomErrors.nameFor(SecurityException()))
        assertEquals("NotFoundError", DomErrors.nameFor(FileNotFoundException()))
        assertEquals("NotReadableError", DomErrors.nameFor(IOException()))
        assertEquals("InvalidStateError", DomErrors.nameFor(IllegalStateException()))
        assertEquals("NotSupportedError", DomErrors.nameFor(IllegalArgumentException()))
        assertEquals("UnknownError", DomErrors.nameFor(RuntimeException()))
    }

    @Test
    fun parsesChunkFrames() {
        val buffer = ByteBuffer.allocate(11).order(ByteOrder.LITTLE_ENDIAN).putInt(42).putInt(7).put(byteArrayOf(1, 2, 3))
        assertEquals(ChunkFrame(42, 7, 8), ChunkFrames.parse(buffer.array()))
        assertNull(ChunkFrames.parse(ByteArray(7)))
    }

    @Test
    fun sanitizesOutputNames() {
        assertEquals("a_b_c.json", OutputNames.sanitize("a/b\\c.json"))
        assertEquals("attachment", OutputNames.sanitize("  "))
        assertEquals("attachment", OutputNames.sanitize(".."))
        assertEquals(120, OutputNames.sanitize("x".repeat(300)).length)
        assertEquals("Ảnh 1.jpg", OutputNames.sanitize("Ảnh 1.jpg"))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:android`
Expected: FAIL with unresolved references (`SafPath`, `TreeGuard`, …).

- [ ] **Step 3: Implement the helpers**

`android/app/src/main/java/app/fbmae/SafPath.kt`:

```kotlin
package app.fbmae

import java.util.Base64

object SafPath {
    /** Decodes the base64url segment after `/saf/` into a document URI string. */
    fun decode(path: String): String? {
        val segment = path.substringBefore('/').substringBefore('?')
        if (segment.isEmpty()) return null
        return try {
            String(Base64.getUrlDecoder().decode(segment), Charsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
```

`android/app/src/main/java/app/fbmae/TreeGuard.kt`:

```kotlin
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
```

`android/app/src/main/java/app/fbmae/WriterRegistry.kt`:

```kotlin
package app.fbmae

import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Output streams opened for JS writers, addressed by integer id. */
class WriterRegistry {
    private class Writer(val stream: OutputStream, val onClose: () -> Unit)

    private val nextId = AtomicInteger(1)
    private val writers = ConcurrentHashMap<Int, Writer>()

    fun open(stream: OutputStream, onClose: () -> Unit = {}): Int {
        val id = nextId.getAndIncrement()
        writers[id] = Writer(stream, onClose)
        return id
    }

    fun write(id: Int, bytes: ByteArray, offset: Int = 0, length: Int = bytes.size) {
        require(id).stream.write(bytes, offset, length)
    }

    fun close(id: Int) {
        val writer = writers.remove(id) ?: throw IllegalStateException("Writer $id is not open.")
        writer.stream.use { it.flush() }
        writer.onClose()
    }

    fun abort(id: Int) {
        writers.remove(id)?.stream?.close()
    }

    fun closeAll() {
        for (id in writers.keys.toList()) abort(id)
    }

    private fun require(id: Int): Writer = writers[id] ?: throw IllegalStateException("Writer $id is not open.")
}
```

`android/app/src/main/java/app/fbmae/DomErrors.kt`:

```kotlin
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
```

`android/app/src/main/java/app/fbmae/ChunkFrames.kt`:

```kotlin
package app.fbmae

import java.nio.ByteBuffer
import java.nio.ByteOrder

data class ChunkFrame(val requestId: Int, val writerId: Int, val payloadOffset: Int)

/** Binary write frames from JS: [u32 LE requestId][u32 LE writerId][payload]. */
object ChunkFrames {
    fun parse(bytes: ByteArray): ChunkFrame? {
        if (bytes.size < 8) return null
        val header = ByteBuffer.wrap(bytes, 0, 8).order(ByteOrder.LITTLE_ENDIAN)
        return ChunkFrame(header.int, header.int, 8)
    }
}
```

`android/app/src/main/java/app/fbmae/OutputNames.kt`:

```kotlin
package app.fbmae

object OutputNames {
    private val unsafe = Regex("[\\\\/:*?\"<>|\\p{Cntrl}]")

    fun sanitize(name: String): String {
        val clean = name.replace(unsafe, "_").trim().take(120)
        return if (clean.isEmpty() || clean == "." || clean == "..") "attachment" else clean
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:android`
Expected: `BUILD SUCCESSFUL`; `PureHelpersTest` 6 passed, `AssetMimeTest` 3 passed.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/app/fbmae android/app/src/test/java/app/fbmae/PureHelpersTest.kt
git commit -m "feat(android): add path, guard, writer, and error helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: SAF bridge, file server and Activity wiring (model: opus)

**Files:**
- Create: `android/app/src/main/java/app/fbmae/SafStore.kt`, `SafPathHandler.kt`, `SafBridge.kt`
- Create: `android/app/src/main/res/xml/file_paths.xml`
- Modify: `android/app/src/main/java/app/fbmae/MainActivity.kt` (whole file)
- Modify: `android/app/src/main/AndroidManifest.xml` (add the provider)

**Interfaces:**
- Consumes: everything from Task 8; `AppAssetsHandler` and `MainActivity.APP_ORIGIN` from Task 7; the wire protocol from Task 3 and the method names from Task 5.
- Produces:
  - `interface ActivityPort { fun pickTree(initial: Uri?, onResult: (Uri?) -> Unit); fun createOutputDocument(name: String, mimeType: String, onResult: (Uri?) -> Unit); fun viewFile(file: File, mimeType: String); fun outputCacheDir(): File }`
  - `SafBridge(store: SafStore, port: ActivityPort, prefs: SharedPreferences, binarySupported: Boolean)`, which implements `WebViewCompat.WebMessageListener` and has `shutdown()`

- [ ] **Step 1: Implement SafStore**

`android/app/src/main/java/app/fbmae/SafStore.kt`:

```kotlin
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
```

- [ ] **Step 2: Implement the `/saf/` handler**

`android/app/src/main/java/app/fbmae/SafPathHandler.kt`:

```kotlin
package app.fbmae

import android.net.Uri
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.IOException

/** Streams granted documents for `fetch('/saf/<base64url document URI>')`. */
class SafPathHandler(private val store: SafStore) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse {
        val uri = SafPath.decode(path) ?: return status(400, "Bad Request")
        if (!TreeGuard.isAllowed(uri, store.grantedTrees())) return status(403, "Forbidden")
        return try {
            val document = Uri.parse(uri)
            WebResourceResponse(store.mimeType(document), null, store.openInput(document))
        } catch (_: SecurityException) {
            status(403, "Forbidden")
        } catch (_: FileNotFoundException) {
            status(404, "Not Found")
        } catch (_: IOException) {
            status(500, "Read Error")
        }
    }

    private fun status(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))
}
```

- [ ] **Step 3: Implement the bridge**

`android/app/src/main/java/app/fbmae/SafBridge.kt`:

```kotlin
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
    }
}
```

- [ ] **Step 4: Wire the Activity**

Replace `android/app/src/main/java/app/fbmae/MainActivity.kt` with:

```kotlin
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
```

- [ ] **Step 5: Register the FileProvider**

`android/app/src/main/res/xml/file_paths.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="open" path="open/" />
</paths>
```

In `android/app/src/main/AndroidManifest.xml`, inside `<application>` after the `<activity>`, add:

```xml
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.files"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
```

- [ ] **Step 6: Build and run the unit tests**

```bash
npm run test:android
```

```bash
npm run build:android
```

Expected: both report `BUILD SUCCESSFUL`, followed by `no INTERNET permission`.

If `WebMessageCompat.getArrayBuffer`, `TYPE_ARRAY_BUFFER` or `WEB_MESSAGE_ARRAY_BUFFER` do not resolve in webkit 1.18.0, check the API in `F:\Project\.gradle\caches\…\webkit-1.18.0-sources.jar` (`androidx/webkit/WebMessageCompat.java`). If no binary message API exists, set `binarySupported` to `false`; the base64 path in Task 3 then covers writes.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main
git commit -m "feat(android): bridge SAF reads, writes, pickers, and external viewing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Release build, size gate and README (model: sonnet)

**Files:**
- Modify: `README.md` (new subsection after "6.3. Build for Production")
- Modify: `docs/superpowers/specs/2026-11-11-android-webview-apk-design.md` (record the deviations)

- [ ] **Step 1: Build the release APK**

Run: `npm run build:android:release`
Expected: `BUILD SUCCESSFUL`, then `app-release.apk: no INTERNET permission`.

- [ ] **Step 2: Measure the size**

```powershell
(Get-Item F:\Project\FB-Messages-Archive-Explorer\android-build\app\outputs\apk\release\app-release.apk).Length / 1MB
```

Expected: ≤ 3.0. If it is larger, list the biggest entries before changing anything:

```bash
unzip -l F:/Project/FB-Messages-Archive-Explorer/android-build/app/outputs/apk/release/app-release.apk | sort -k1 -n | tail -15
```

Then report the numbers to the owner.

- [ ] **Step 3: Document the Android app**

Add to `README.md` after the "6.3. Build for Production" subsection:

````markdown
**Build the Android app (APK)**

The Android app runs the same web app in a WebView and opens folders through the Android Storage Access Framework, so every feature, including write features such as deletion, bookmarks and message edits, works on Android. The APK has no internet permission.

Requirements: JDK 17 or later and the Android SDK with platform 37. Create `android/local.properties` with `sdk.dir=…`. Optionally add `fbmae.outputRoot=<folder>` to put build output outside the source tree.

```bash
npm run build:android
```

```bash
npm run build:android:release
```

Without `android/keystore.properties`, the release APK is signed with the debug key; it can be sideloaded but not published.

On Android 11 and later, the folder picker cannot select the root of internal storage or the root of `Download`. Extract the export into its own folder, for example `Download/facebook-export`, and select that folder.

Measured on a Galaxy S23: release APK size …, cold start …, memory while playing a 300 MB video ….
````

Leave the measured numbers as `…` for now; Task 12 fills them in.

- [ ] **Step 4: Record the deviations in the spec**

In `docs/superpowers/specs/2026-11-11-android-webview-apk-design.md`:
- §3.1: change `minSdk 29` to `minSdk 30`.
- §3.2: change the release signing bullet to: "Release signing reads `android/keystore.properties` (gitignored); without it, release builds are signed with the debug key for sideloading."
- §4.2 `createWritable()` row: change "on the first write" to "when `createWritable()` is called".

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-11-android-webview-apk-design.md
git commit -m "docs(android): document APK build and record design deviations" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Web regression (model: haiku)

**Files:** none

- [ ] **Step 1: Run the full web checks**

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run build
```

Expected: all pass. The test count is the Task 0 baseline plus the new Android tests: 2 + 3 + 8 + 12 + 5 + 8 = 38.

- [ ] **Step 2: Run the browser workflows with output on F:**

```bash
npm run build
```

```bash
npx vite preview --port 4173 --strictPort
```

Run the preview in the background, then:

```bash
npx playwright test -c F:/Project/FB-Messages-Archive-Explorer/playwright.local.config.mjs
```

Before running, check that the config's `testDir` points at the Android worktree, `D:/Personal/Coding/FB-Messages-Archive-Explorer-android/e2e`. If it does not, copy the config to `F:/Project/FB-Messages-Archive-Explorer/playwright.android-worktree.config.mjs` with that `testDir` and the worktree's `node_modules` import path, and run the copy.

Expected: all specs pass. Stop the preview server by its PID afterwards.

- [ ] **Step 3: Confirm the hosted bundle is unchanged in shape**

```bash
ls dist
```

Expected: `sw.js`, `manifest.webmanifest`, `guide/` and `index.html` are present; `index.html` references `/FB-Messages-Archive-Explorer/assets/`.

---

### Task 12: Fake archive and S23 verification (model: sonnet)

**Files:**
- Create: `scripts/make-fake-archive.mjs`
- Modify: `README.md` (fill in the measured numbers)

- [ ] **Step 1: Write the fake-archive generator**

`scripts/make-fake-archive.mjs`:

```js
#!/usr/bin/env node
// Generates fake Facebook and Messenger exports for device tests. No real data.
// Usage: node scripts/make-fake-archive.mjs <outputDir> [--big-video]
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('Pass an output directory.');
const bigVideo = process.argv.includes('--big-video');
rmSync(out, { recursive: true, force: true });

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function media(dir) {
  mkdirSync(dir, { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', join(dir, 'photo.png')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-pix_fmt', 'yuv420p', join(dir, 'clip.mp4')]);
  if (bigVideo) {
    // About 300 MB: 120 s at a constant 20 Mbit/s with noise so x264 cannot compress it away.
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '120', '-vf', 'noise=alls=40:allf=t',
      '-c:v', 'libx264', '-b:v', '20M', '-minrate', '20M', '-maxrate', '20M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', join(dir, 'big.mp4')]);
  }
}

// Facebook layout: your_facebook_activity/messages/inbox/<thread>/message_1.json
const inbox = join(out, 'facebook', 'your_facebook_activity', 'messages', 'inbox');
for (const [folder, other, count] of [['alice_100', 'Alice', 200], ['bob_200', 'Bob', 20]]) {
  const dir = join(inbox, folder);
  media(join(dir, 'photos'));
  const messages = Array.from({ length: count }, (_, index) => ({
    sender_name: index % 2 ? 'Tester' : other,
    timestamp_ms: 1767225600000 - index * 3600000,
    content: `fake message ${index} lỗi tiếng Việt`,
    ...(index === 3 ? { photos: [{ uri: `your_facebook_activity/messages/inbox/${folder}/photos/photo.png` }] } : {}),
    ...(index === 5 ? { videos: [{ uri: `your_facebook_activity/messages/inbox/${folder}/photos/clip.mp4` }] } : {}),
  }));
  writeFileSync(join(dir, 'message_1.json'), JSON.stringify({ participants: [{ name: other }, { name: 'Tester' }], messages, title: other }));
}

// Standalone Messenger layout: <thread>.json plus a media folder (overlay features apply here).
const messenger = join(out, 'messenger');
media(join(messenger, 'media'));
const thread = (name, count) => ({
  threadName: name,
  participants: [name, 'Tester'],
  messages: Array.from({ length: count }, (_, index) => ({
    senderName: index % 2 ? 'Tester' : name,
    text: `Messenger fake ${index} needle`,
    timestamp: 1767225600000 + index * 60000,
    ...(index === 2 ? { media: [{ uri: 'media/photo.png' }] } : {}),
    ...(index === 4 ? { media: [{ uri: 'media/clip.mp4' }] } : {}),
    ...(index === 6 && bigVideo ? { media: [{ uri: 'media/big.mp4' }] } : {}),
  })),
});
writeFileSync(join(messenger, 'Messenger Alice_0.json'), JSON.stringify(thread('Messenger Alice', 300)));
writeFileSync(join(messenger, 'Messenger Bob_0.json'), JSON.stringify(thread('Messenger Bob', 30)));
console.log(`Fake archives written to ${out}`);
```

- [ ] **Step 2: Generate and validate the fake data on desktop**

```bash
node scripts/make-fake-archive.mjs F:/Project/FB-Messages-Archive-Explorer/fake/fbmae-device --big-video
```

Then run `npm run dev`. In desktop Chrome, open both the `facebook` and the `messenger` folders. Expected: both load, chats are listed, and the photo and video render.

If the Messenger layout is not recognized, compare it with `e2e/helpers/archive.ts` (lines 138-160) and with `src/services/messengerExport/messengerExportDetector.ts`, fix the generator, and rerun. Do not change the app for this step.

- [ ] **Step 3: Take the S23 lock**

```powershell
Test-Path D:\Personal\Coding\.s23.lock
```

If the lock exists, stop. Tell the owner the device is busy and continue only when they say it is free. If it does not exist:

```powershell
Set-Content D:\Personal\Coding\.s23.lock "FB-MAE device test $(Get-Date -Format HH:mm)"
```

- [ ] **Step 4: Install the APK and push the fake data**

```bash
adb -s RFCX70GZ85Y install --user 0 -r F:/Project/FB-Messages-Archive-Explorer/android-build/app/outputs/apk/release/app-release.apk
```

```bash
adb -s RFCX70GZ85Y push F:/Project/FB-Messages-Archive-Explorer/fake/fbmae-device /sdcard/Download/fbmae-test
```

```bash
adb -s RFCX70GZ85Y shell am start -W --user 0 -n app.fbmae/.MainActivity
```

Record `TotalTime` from the `am start -W` output as the cold start time.

- [ ] **Step 5: Run the device checklist**

Drive the UI with `adb -s RFCX70GZ85Y shell uiautomator dump /sdcard/fbmae-ui.xml`, `adb -s RFCX70GZ85Y pull /sdcard/fbmae-ui.xml F:/Project/FB-Messages-Archive-Explorer/shots/` and `adb -s RFCX70GZ85Y shell input tap X Y`. Take screenshots with `adb -s RFCX70GZ85Y exec-out screencap -p > F:/Project/FB-Messages-Archive-Explorer/shots/<step>.png`.

Mark each item pass or fail:

1. Open Folder → system picker → `Download/fbmae-test/messenger` → "Use this folder" → allow. Expected: the chat list shows two Messenger chats.
2. Open "Messenger Alice"; scroll; search "needle". Expected: results, and ▲/▼ step through them.
3. Gallery: photo and clip thumbnails render; open the photo in the viewer.
4. Play `big.mp4` and seek to the middle. Record `adb -s RFCX70GZ85Y shell dumpsys meminfo app.fbmae` (TOTAL PSS) during playback.
5. Favorite a message. Expected: `Messenger Alice_0.overlay.json` appears; check with `adb -s RFCX70GZ85Y shell ls /sdcard/Download/fbmae-test/messenger`.
6. Hide a message, then use "Export bản sạch". Expected: `*.cleaned.json` exists.
7. Enable bookmarking, bookmark the photo. Expected: `fb-mae/bookmarks.json` exists.
8. Select two attachments → Download ZIP → save-as picker → Downloads. Expected: the ZIP exists and has the size reported in the app.
9. Save to folder → pick `Download/fbmae-test/out`. Expected: the files are copied.
10. Open the raw chat JSON from the chat list menu. Expected: the chooser shows a viewer app.
11. Enable chat deletion; delete "Messenger Bob". Expected: its JSON is gone; other files remain.
12. Reopen the app, open the `facebook` folder. Expected: the Alice and Bob chats load, with media.
13. Rotate the device while a chat is open. Expected: the chat stays open.
14. Press Back from a chat. Expected: the app returns to the chat list; Back on the list closes the app.

- [ ] **Step 6: Clean up the device**

```bash
adb -s RFCX70GZ85Y shell rm -rf /sdcard/Download/fbmae-test /sdcard/fbmae-ui.xml
```

Remove any ZIP saved under `/sdcard/Download/` in item 8. Uninstall the app only if the owner asks (`adb -s RFCX70GZ85Y uninstall --user 0 app.fbmae`). Then delete the lock:

```powershell
Remove-Item D:\Personal\Coding\.s23.lock
```

- [ ] **Step 7: Record the numbers and decide on the large-media follow-up**

Fill in the README "Measured on a Galaxy S23" line with:
- the release APK size from Task 10;
- the cold start time;
- the TOTAL PSS during `big.mp4` playback.

If item 4 crashed, or the TOTAL PSS exceeded roughly 1.5 GB, report this to the owner and propose the `nativeUrl` + HTTP Range follow-up from spec §4.5. Do not build it unasked.

- [ ] **Step 8: Commit**

```bash
git add scripts/make-fake-archive.mjs README.md
git commit -m "test(android): add fake archive generator and record S23 results" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Remove heavy temporary output**

30 minutes after the last use, and after the numbers are in the README, delete the following, so that only the APK outputs remain:
- `F:\Project\FB-Messages-Archive-Explorer\fake\fbmae-device`;
- the screenshots in `F:\Project\FB-Messages-Archive-Explorer\shots\`.
