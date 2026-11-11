# Android WebView APK: Design

Date: 2026-11-11
Branch: `feat/android-webview` (from `feat/message-overlay`)
Status: approved in brainstorming, awaiting spec review

## 1. Goal

Package the existing web app as a lightweight Android APK for personal sideloading. The APK keeps every feature, including write features: overlay edits (soft delete, favorites, cleaned and favorites exports), bookmarks and pinned chats, chat deletion, saving attachments to a folder, and ZIP downloads.

Out of scope: Play Store and GitHub Release publishing, a native UI rewrite, and Capacitor or TWA wrappers. An earlier Capacitor attempt on branch `feat/android-apk` is not reused.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Feature scope | Full read and write, including chat deletion |
| Distribution | Personal sideload; release APK signed with a local keystore |
| Packaging | Plain Kotlin WebView shell with a custom Storage Access Framework (SAF) bridge |
| Test device | Galaxy S23 (`RFCX70GZ85Y`) when `D:\Personal\Coding\.s23.lock` is free; Gallery has priority |
| Web code impact | One dynamic import in `src/main.tsx` plus Android-only modules; the web build stays unchanged |

## 3. Architecture

```
┌──────────────────────── APK ────────────────────────┐
│ MainActivity (Kotlin)                               │
│  └─ WebView ── https://appassets.androidplatform.net│
│       ├─ /           → bundled web build (assets)   │
│       ├─ /saf/<uri>  → SafPathHandler (stream read) │
│       └─ "fbmae" WebMessage channel → SafBridge     │
│                                         ├─ list     │
│                                         ├─ create   │
│                                         ├─ write    │
│                                         ├─ delete   │
│                                         ├─ pick     │
│                                         ├─ save-as  │
│                                         └─ open     │
└─────────────────────────────────────────────────────┘
```

The React app talks only to the handle interfaces in `src/types/fileSystem.ts`. The Android shim installs `window.showDirectoryPicker`, which returns SAF-backed handles, so the existing code paths run unchanged.

### 3.1 Repository layout

- `android/`: a Gradle project with one `app` module written in Kotlin, with no Compose and no AppCompat. The only library dependency is `androidx.webkit`. `minSdk 29`, `compileSdk 37`, `targetSdk 37`.
- `src/platform/android/`:
  - `nativeBridge.ts`: request and response transport over the `fbmae` channel.
  - `safHandles.ts`: `SafDirectoryHandle`, `SafFileHandle` and `SafWritable`, which implement `WritableDirectoryHandle`, `WritableFileHandle` and the writable stream subset the app uses.
  - `androidDownloads.ts`: intercepts `<a download>` blob links and patches `window.open` for blob URLs.
  - `install.ts`: installs the picker, download hooks and UI flags when the app runs in the APK.
- `src/main.tsx`: `if (import.meta.env.MODE === 'android') await import('./platform/android/install')`.

### 3.2 Build

- `npm run build:android` runs `vite build --mode android`:
  - `base: '/'`;
  - VitePWA configured with `disable: true`, so `virtual:pwa-register/react` still resolves (verify during planning);
  - output to `F:\Project\FB-Messages-Archive-Explorer\android-web\`.
- Gradle reads its assets from that folder and writes `layout.buildDirectory` to `F:\Project\FB-Messages-Archive-Explorer\android-build\`.
- Builds use the project lock `F:\Project\FB-Messages-Archive-Explorer\gradle.lock`. `GRADLE_USER_HOME` stays `F:\Project\.gradle`. Never run `gradlew --stop`.
- Release signing reads `android/keystore.properties` (gitignored). The keystore file lives outside the repository.
- Release builds enable R8 and `shrinkResources`.

## 4. SAF bridge

### 4.1 Transport

- Control calls use `WebViewCompat.addWebMessageListener` on channel `fbmae`, restricted to origin `https://appassets.androidplatform.net`.
- A message is `{ id, method, args }`. Kotlin runs each call on a background executor and replies `{ id, ok, result | error: { name, message } }`.
- File bytes are read with `fetch('/saf/<encoded document URI>')`, which a `WebViewAssetLoader.PathHandler` serves by streaming `ContentResolver.openInputStream`. The response carries `Content-Type` and `Content-Length`. URIs outside a granted tree are rejected with 403.
- Writes send 1 MB `ArrayBuffer` chunks when `WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER` is supported. Otherwise they send base64 strings of the same chunk size.

### 4.2 Handles

| Web API | Android implementation |
| --- | --- |
| `showDirectoryPicker({mode})` | `ACTION_OPEN_DOCUMENT_TREE` with `EXTRA_INITIAL_URI` set to the last tree, then `takePersistableUriPermission(READ or WRITE)` |
| `entries()` | One `DocumentsContract` children query projecting id, display name, MIME type, size and last modified time. Results are cached per handle. |
| `getDirectoryHandle` / `getFileHandle` | Look up the cached children; with `{create: true}`, call `DocumentsContract.createDocument` (`application/octet-stream` for files so providers keep the exact name) |
| `getFile()` | `fetch('/saf/…')` → `new File([blob], name, { type, lastModified })` |
| `createWritable()` | Native opens an output stream in mode `"wt"` on the first write. `write(string | Blob | BufferSource)`, `close()`, `abort()`. |
| `removeEntry(name, {recursive})` | `DocumentsContract.deleteDocument`, then invalidate the parent cache |
| `queryPermission` / `requestPermission` | `granted` when a persisted permission includes write |

Create and delete calls invalidate the parent directory's cache.

### 4.3 Error mapping

| Native condition | `DOMException.name` |
| --- | --- |
| Picker cancelled | `AbortError` |
| `SecurityException`, revoked permission | `NotAllowedError` |
| `FileNotFoundException`, missing child | `NotFoundError` |
| `IOException` on read | `NotReadableError` |
| Name already exists as the other kind | `TypeMismatchError` |
| No reply within 60 s (reset after each write chunk) | `TimeoutError` |

### 4.4 Known platform limit

[Unverified] Android 11 and later do not allow picking the storage root or the root of `Download` in the tree picker. Users pick the extracted export folder, such as `Download/facebook-xxx`. The README documents this.

### 4.5 Large media risk

The app reads media through `getFile()` and `URL.createObjectURL`, so each file is loaded fully into a blob. The S23 test measures memory with a ~300 MB fake video. If memory use is unacceptable, a follow-up adds a `nativeUrl` property to `SafFileHandle`, makes `src/services/blobCache.ts` use it as the `src` for `<video>` and `<audio>`, and adds HTTP Range support to the `/saf/` handler. This follow-up is built only if the measurement requires it.

## 5. Downloads, external opening and shell behavior

- **Downloads:** `androidDownloads.ts` intercepts clicks and `HTMLAnchorElement.prototype.click` for anchors that have `download` and a `blob:` `href`. This covers `MediaViewer.tsx:685`, `saveAttachments.ts:227`, `saveAttachments.ts:391` (ZIP) and `useOverlay.tsx:96`. Native runs `ACTION_CREATE_DOCUMENT` with the suggested name, and the bytes stream through the chunked writer.
- **Save to folder** works through the picker shim with `mode: 'readwrite'`.
- **Opening a blob externally:** this covers `ChatList.tsx:90` and `blobCache.ts:96`. The patched `window.open` returns a stub whose `location.href` setter and `close()` match the `about:blank`-then-assign pattern. Native writes the bytes to `cacheDir/open/` and starts `ACTION_VIEW` through a `FileProvider` chooser. That folder is cleared on app start.
- **External links:** multiple windows are disabled. `shouldOverrideUrlLoading` opens every URL outside `appassets.androidplatform.net` in the external browser.
- **No `INTERNET` permission.** `index.html` and the CSS reference no remote resources; the only URL is the canonical link in `index.html`.
- **Back button:** `OnBackPressedDispatcher` calls `webView.goBack()` when `canGoBack()` is true, and finishes the Activity otherwise. The app already drives navigation through `history` and `popstate` (`src/services/mobileNavigation.ts`).
- **Configuration changes:** `android:configChanges` covers orientation, screen size, smallest screen size, screen layout, keyboard and keyboard hidden, so the loaded archive survives rotation.
- **Edge-to-edge:** window insets are applied as padding on the WebView container.
- **WebView settings:**
  - JavaScript and DOM storage enabled;
  - `allowFileAccess` and `allowContentAccess` set to `false`;
  - mixed content set to never allowed.
- **Renderer crash:** `onRenderProcessGone` recreates the WebView and shows the "Đã tải lại app" message.

### 5.1 Android-only UI changes

These apply only in mode `android`:

- Hide the **Offline use** settings section and `ReloadPrompt`.
- Hide the read-only / upload folder access option; Android always uses native access.

Messages such as "only available in Chromium browsers" disappear without code changes, because the shim makes `isFileSystemAccessSupported()` return `true`.

## 6. Testing

Order per feature: unit tests first, then the S23 device.

1. **Vitest (jsdom)** with an in-memory fake bridge, covering:
   - `entries`, the lookup cache, creating files and directories;
   - chunked writes, `abort`, `removeEntry`;
   - error mapping, permissions;
   - download interception and the `window.open` stub.
2. **JUnit (plain JVM)**, covering:
   - tree-membership checks for document URIs;
   - `/saf/` path encoding and decoding;
   - the chunked writer state machine with fake streams.
3. **Web regression:** `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` once at the end.
4. **S23 device** (only when `.s23.lock` is free):
   - Fake archive data: the e2e fixtures plus a ~300 MB fake video, prepared under `F:\Project\FB-Messages-Archive-Explorer\fake\` and pushed to `/sdcard/Download/fbmae-test/`.
   - Install with `adb -s RFCX70GZ85Y install --user 0`. Drive the SAF picker with `uiautomator dump` and `input tap`.
   - Checklist:
     - pick folder, open chat, search, gallery;
     - view an image, play and seek a video;
     - favorite (overlay file write), bookmark, cleaned export;
     - delete a fake chat, ZIP download, save to folder, open JSON externally;
     - Back button, rotation.
   - Cleanup: delete the fake data from the phone and remove the lock file. Uninstall the app only if the owner asks.

## 7. Done criteria

- Release APK ≤ 3 MB (target). Record the measured size.
- The merged manifest has no `INTERNET` permission (`aapt dump permissions`).
- All existing and new tests pass.
- Every item on the S23 checklist passes.
- Opening the 300 MB fake video does not crash. Record `dumpsys meminfo`, cold start time (`am start -W`) and APK size in the README.
- The README has an "Android app" section covering build steps, the SAF folder-picking limit and the measured numbers.
