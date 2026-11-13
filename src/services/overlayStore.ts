import type { Overlay } from '../types/overlay';
import { parseOverlay, serializeOverlay } from './overlay';

// Fallback for folders opened without write access (read-only picker, folder
// upload, Firefox, Safari). Stored overlays never leave the browser.
const DATABASE = 'fb-mae-overlays';
const STORE = 'overlays';

export function getOverlayStoreKey(directoryName: string, sourceFile: string): string {
  return `${directoryName}/${sourceFile}`;
}

export function isOverlayStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isOverlayStoreAvailable()) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadStoredOverlay(key: string, sourceFile: string): Promise<Overlay | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise(resolve => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? parseOverlay(request.result, sourceFile) : null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function saveStoredOverlay(key: string, overlay: Overlay): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  try {
    return await new Promise(resolve => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(serializeOverlay(overlay), key);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    });
  } catch {
    return false;
  } finally {
    database.close();
  }
}
