// Persists "All" search indexes so a reopened archive skips JSON parsing.
// Records never leave the browser; a fingerprint mismatch means "rebuild".
import type { SearchIndexEntry } from '../../types/messenger';
import type { SearchIndexStore } from './wideSearchCore';

const DATABASE = 'fb-mae-search-index';
const STORE = 'indexes';
const SAVED_AT = 'savedAt';
const DEFAULT_MAX_ENTRIES = 500;

interface StoredIndex {
  fingerprint: string;
  entries: SearchIndexEntry[];
  savedAt: number;
}

let lastSavedAt = 0;
function nextSavedAt(): number {
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
  return lastSavedAt;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Aborted', 'AbortError'));
  });
}

export function createIndexedDbSearchIndexStore(options: { maxEntries?: number } = {}): SearchIndexStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  let database: Promise<IDBDatabase | null> | null = null;

  const open = (): Promise<IDBDatabase | null> => {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    database ??= new Promise(resolve => {
      try {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE);
          store.createIndex(SAVED_AT, SAVED_AT);
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); database = null; };
          resolve(db);
        };
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return database;
  };

  return {
    async load(key, fingerprint) {
      const db = await open();
      if (!db) return null;
      const stored = await requestResult<StoredIndex | undefined>(
        db.transaction(STORE, 'readonly').objectStore(STORE).get(key),
      );
      return stored && stored.fingerprint === fingerprint ? stored.entries : null;
    },

    async save(key, fingerprint, entries) {
      const db = await open();
      if (!db) return;
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      store.put({ fingerprint, entries, savedAt: nextSavedAt() } satisfies StoredIndex, key);
      const count = await requestResult(store.count());
      let excess = count - maxEntries;
      if (excess > 0) {
        const cursorRequest = store.index(SAVED_AT).openKeyCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || excess <= 0) return;
          store.delete(cursor.primaryKey);
          excess--;
          cursor.continue();
        };
      }
      await transactionDone(transaction);
    },

    async clear() {
      const db = await open();
      if (!db) return;
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).clear();
      await transactionDone(transaction);
    },
  };
}
