import { createOutputSink, installDownloadHooks } from './androidDownloads';
import { connectNativeBridge, type NativePort } from './nativeBridge';
import { SafDirectoryHandle } from './safHandles';
import { createSavedFolder, installSavedFolder } from './savedFolder';
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

export async function installAndroidPlatform(win: Window & typeof globalThis = window): Promise<void> {
  const port = win.fbmae;
  if (!port) throw new Error('The Android bridge is unavailable.');
  const native = createAndroidNative(await connectNativeBridge(port));
  win.showDirectoryPicker = createDirectoryPicker(native) as unknown as Window['showDirectoryPicker'];
  installDownloadHooks(win, createOutputSink(native));
  installSavedFolder(createSavedFolder(native));
}
