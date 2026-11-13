import type { ReadableDirectoryHandle } from '../../types/fileSystem';
import { SafDirectoryHandle } from './safHandles';
import type { AndroidNative } from './safNative';

/** Reopens the last archive folder when the Android app starts again. */
export interface SavedFolder {
  restore(): Promise<SafDirectoryHandle | null>;
  remember(handle: ReadableDirectoryHandle): Promise<void>;
}

export function createSavedFolder(native: AndroidNative): SavedFolder {
  return {
    async restore() {
      try {
        const saved = await native.restoreDirectory();
        return saved ? new SafDirectoryHandle(native, saved.treeUri, saved) : null;
      } catch (error) {
        console.warn('[Android] Could not restore the last folder:', error);
        return null;
      }
    },
    async remember(handle) {
      if (!(handle instanceof SafDirectoryHandle)) return;
      try {
        await native.rememberDirectory(handle.treeUri);
      } catch (error) {
        console.warn('[Android] Could not remember the folder:', error);
      }
    },
  };
}

let current: SavedFolder | null = null;

export function installSavedFolder(savedFolder: SavedFolder | null): void {
  current = savedFolder;
}

/** Null outside the Android app, or before the platform bridge is ready. */
export function getSavedFolder(): SavedFolder | null {
  return current;
}
