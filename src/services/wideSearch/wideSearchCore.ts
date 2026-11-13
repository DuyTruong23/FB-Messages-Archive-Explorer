// Worker-safe: no DOM access. Runs inside wideSearchWorker, or on the main
// thread when Workers are unavailable.
import type { MessengerThread, SearchIndexEntry } from '../../types/messenger';
import { buildSearchIndex, performSearch } from '../search';
import { isReactionNoticeMessage } from '../reactions';
import { mergeMessengerData, normalizeMessengerData, parseMessengerJsonContent } from '../parser';
import { parseMessengerExportJson } from '../messengerExport/messengerExportParser';
import { DEFAULT_SEARCH_FILTER } from '../searchFilters';
import { FILE_READ_CONCURRENCY, mapWithConcurrency } from '../concurrency';

export type WideSearchChatKind = 'facebook' | 'messenger-export';

export interface WideSearchChatRequest {
  /** Stable chat identity, including every option that changes the index. */
  key: string;
  kind: WideSearchChatKind;
  /** Facebook parts in loader order (message_1.json first), or one export JSON. */
  files: File[];
  hideNotices: boolean;
  query: string;
  normalize: boolean;
  deletedMask?: Uint8Array;
}

export interface SearchIndexStore {
  load(key: string, fingerprint: string): Promise<SearchIndexEntry[] | null>;
  save(key: string, fingerprint: string, entries: SearchIndexEntry[]): Promise<void>;
  clear(): Promise<void>;
}

/** Bump when buildSearchIndex output changes so stored indexes are rebuilt. */
export const SEARCH_INDEX_VERSION = 1;

export function getFilesFingerprint(files: readonly File[]): string {
  return `v${SEARCH_INDEX_VERSION}|` + files.map(f => `${f.name}:${f.size}:${f.lastModified}`).join('|');
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

async function parseChatFiles(kind: WideSearchChatKind, files: File[]): Promise<MessengerThread> {
  if (kind === 'messenger-export') return parseMessengerExportJson(await files[0].text());

  // Same steps as parserWorker, so result indices match the chat view.
  const parts = await mapWithConcurrency(files, FILE_READ_CONCURRENCY, async part => {
    try {
      const data = parseMessengerJsonContent(await part.text());
      return Array.isArray(data?.messages) ? data : null;
    } catch {
      return null;
    }
  });
  const readable = parts.filter((part): part is MessengerThread => part !== null);
  if (!readable.length) throw new Error('No readable message JSON files.');
  return normalizeMessengerData(mergeMessengerData(readable));
}

export class WideSearchEngine {
  private readonly memory = new Map<string, { fingerprint: string; index: SearchIndexEntry[] }>();
  private readonly building = new Map<string, Promise<SearchIndexEntry[]>>();

  private readonly store: SearchIndexStore | null;
  private readonly memoryLimit: number;

  constructor(store: SearchIndexStore | null, memoryLimit = 50) {
    this.store = store;
    this.memoryLimit = memoryLimit;
  }

  async searchChat(request: WideSearchChatRequest, signal?: AbortSignal): Promise<SearchIndexEntry[]> {
    if (signal?.aborted) throw abortError();
    const index = await this.getIndex(request);
    if (signal?.aborted) throw abortError();
    const found = await performSearch(request.query, index, undefined, signal, {
      filter: { ...DEFAULT_SEARCH_FILTER, normalize: request.normalize },
      deletedMask: request.deletedMask,
    });
    return found.map(result => result.item);
  }

  /** Drops in-memory indexes. Stored indexes stay valid through their fingerprints. */
  clearMemory(): void {
    this.memory.clear();
  }

  async clearAll(): Promise<void> {
    this.memory.clear();
    try { await this.store?.clear(); } catch { /* best effort */ }
  }

  private async getIndex(request: WideSearchChatRequest): Promise<SearchIndexEntry[]> {
    const fingerprint = getFilesFingerprint(request.files);
    const cached = this.memory.get(request.key);
    if (cached?.fingerprint === fingerprint) {
      this.remember(request.key, cached);
      return cached.index;
    }

    const flightKey = `${request.key}\n${fingerprint}`;
    let pending = this.building.get(flightKey);
    if (!pending) {
      pending = this.loadOrBuild(request, fingerprint).finally(() => this.building.delete(flightKey));
      this.building.set(flightKey, pending);
    }
    return pending;
  }

  private async loadOrBuild(request: WideSearchChatRequest, fingerprint: string): Promise<SearchIndexEntry[]> {
    let index: SearchIndexEntry[] | null = null;
    try { index = (await this.store?.load(request.key, fingerprint)) ?? null; } catch { index = null; }

    if (!index) {
      const data = await parseChatFiles(request.kind, request.files);
      const hideNotice = request.hideNotices && request.kind === 'facebook';
      index = buildSearchIndex(data.messages, hideNotice ? isReactionNoticeMessage : () => false);
      try { await this.store?.save(request.key, fingerprint, index); } catch { /* best effort */ }
    }

    this.remember(request.key, { fingerprint, index });
    return index;
  }

  private remember(key: string, value: { fingerprint: string; index: SearchIndexEntry[] }): void {
    this.memory.delete(key);
    this.memory.set(key, value);
    while (this.memory.size > this.memoryLimit) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }
}
