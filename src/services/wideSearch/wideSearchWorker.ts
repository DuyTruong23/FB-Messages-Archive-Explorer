import { WideSearchEngine, type WideSearchChatRequest } from './wideSearchCore';
import { createIndexedDbSearchIndexStore } from './searchIndexStore';

export type WideSearchWorkerRequest =
  | { type: 'search'; id: number; request: WideSearchChatRequest }
  | { type: 'cancel'; id: number }
  | { type: 'clear-memory' }
  | { type: 'clear-all'; id: number };

export type WideSearchWorkerResponse =
  | { type: 'result'; id: number; items: import('../../types/messenger').SearchIndexEntry[] }
  | { type: 'error'; id: number; error: string; aborted: boolean }
  | { type: 'cleared'; id: number };

const engine = new WideSearchEngine(createIndexedDbSearchIndexStore());
const running = new Map<number, AbortController>();

self.onmessage = async (event: MessageEvent<WideSearchWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    running.get(message.id)?.abort();
    running.delete(message.id);
    return;
  }
  if (message.type === 'clear-memory') {
    engine.clearMemory();
    return;
  }
  if (message.type === 'clear-all') {
    await engine.clearAll();
    self.postMessage({ type: 'cleared', id: message.id } satisfies WideSearchWorkerResponse);
    return;
  }

  const controller = new AbortController();
  running.set(message.id, controller);
  try {
    const items = await engine.searchChat(message.request, controller.signal);
    if (!controller.signal.aborted) self.postMessage({ type: 'result', id: message.id, items } satisfies WideSearchWorkerResponse);
  } catch (error) {
    if (controller.signal.aborted) return;
    self.postMessage({
      type: 'error', id: message.id,
      error: error instanceof Error ? error.message : String(error),
      aborted: error instanceof Error && error.name === 'AbortError',
    } satisfies WideSearchWorkerResponse);
  } finally {
    running.delete(message.id);
  }
};
