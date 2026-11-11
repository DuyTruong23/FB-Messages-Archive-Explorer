import type { SearchIndexEntry } from '../../types/messenger';
import { WideSearchEngine, type WideSearchChatRequest } from './wideSearchCore';
import { createIndexedDbSearchIndexStore } from './searchIndexStore';
import type { WideSearchWorkerRequest, WideSearchWorkerResponse } from './wideSearchWorker';

export interface WideSearchClient {
  searchChat(request: WideSearchChatRequest, signal?: AbortSignal): Promise<SearchIndexEntry[]>;
  /** Forget in-memory indexes; stored ones are re-validated by fingerprint. */
  clearMemory(): void;
  /** Also delete stored indexes. */
  clearAll(): Promise<void>;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** Runs the engine on the calling thread (tests, browsers without module workers). */
export function createInProcessWideSearchClient(engine = new WideSearchEngine(createIndexedDbSearchIndexStore())): WideSearchClient {
  return {
    searchChat: (request, signal) => engine.searchChat(request, signal),
    clearMemory: () => engine.clearMemory(),
    clearAll: () => engine.clearAll(),
  };
}

function createWorkerWideSearchClient(worker: Worker): WideSearchClient {
  let nextId = 1;
  const pending = new Map<number, { resolve: (items: SearchIndexEntry[]) => void; reject: (error: unknown) => void }>();
  const clears = new Map<number, () => void>();
  const post = (message: WideSearchWorkerRequest) => worker.postMessage(message);

  worker.onmessage = (event: MessageEvent<WideSearchWorkerResponse>) => {
    const message = event.data;
    if (message.type === 'cleared') {
      clears.get(message.id)?.();
      clears.delete(message.id);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.type === 'result') waiter.resolve(message.items);
    else waiter.reject(message.aborted ? abortError() : new Error(message.error));
  };
  worker.onerror = event => {
    const error = new Error(`Search worker error: ${event.message}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  return {
    searchChat(request, signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          pending.delete(id);
          post({ type: 'cancel', id });
          reject(abortError());
        };
        pending.set(id, {
          resolve: items => { signal?.removeEventListener('abort', onAbort); resolve(items); },
          reject: error => { signal?.removeEventListener('abort', onAbort); reject(error); },
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        post({ type: 'search', id, request });
      });
    },
    clearMemory: () => post({ type: 'clear-memory' }),
    clearAll() {
      const id = nextId++;
      return new Promise<void>(resolve => {
        clears.set(id, resolve);
        post({ type: 'clear-all', id });
      });
    },
  };
}

let shared: WideSearchClient | null = null;

export function getWideSearchClient(): WideSearchClient {
  if (shared) return shared;
  if (typeof Worker === 'function') {
    try {
      shared = createWorkerWideSearchClient(
        new Worker(new URL('./wideSearchWorker.ts', import.meta.url), { type: 'module' }),
      );
      return shared;
    } catch {
      // Fall through to the in-process engine.
    }
  }
  shared = createInProcessWideSearchClient();
  return shared;
}
