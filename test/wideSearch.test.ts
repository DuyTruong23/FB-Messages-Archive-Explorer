import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchIndexEntry } from '../src/types/messenger';
import {
  WideSearchEngine,
  getFilesFingerprint,
  type SearchIndexStore,
  type WideSearchChatRequest,
} from '../src/services/wideSearch/wideSearchCore';
import { createIndexedDbSearchIndexStore } from '../src/services/wideSearch/searchIndexStore';

function file(name: string, body: unknown, lastModified = 1): File {
  return new File([JSON.stringify(body)], name, { lastModified });
}

function facebookPart(...contents: string[]) {
  return {
    participants: [{ name: 'Alice' }, { name: 'Bob' }],
    messages: contents.map((content, index) => ({ sender_name: 'Alice', timestamp_ms: 1000 - index, content })),
  };
}

function request(overrides: Partial<WideSearchChatRequest>): WideSearchChatRequest {
  return {
    key: 'chat',
    kind: 'facebook',
    files: [file('message_1.json', facebookPart('hello needle', 'other'))],
    hideNotices: false,
    query: 'needle',
    normalize: true,
    ...overrides,
  };
}

function memoryStore(): SearchIndexStore & { data: Map<string, { fingerprint: string; entries: SearchIndexEntry[] }> } {
  const data = new Map<string, { fingerprint: string; entries: SearchIndexEntry[] }>();
  return {
    data,
    load: async (key, fingerprint) => {
      const hit = data.get(key);
      return hit && hit.fingerprint === fingerprint ? hit.entries : null;
    },
    save: async (key, fingerprint, entries) => { data.set(key, { fingerprint, entries }); },
    clear: async () => { data.clear(); },
  };
}

describe('wide search engine', () => {
  it('indexes Facebook chat parts and returns matches with message indices', async () => {
    const engine = new WideSearchEngine(null);
    const found = await engine.searchChat(request({
      files: [
        file('message_1.json', facebookPart('newest needle')),
        file('message_2.json', facebookPart('older needle', 'plain')),
      ],
    }));
    expect(found.map(item => item.text).sort()).toEqual(['newest needle', 'older needle']);
  });

  it('indexes a Messenger export conversation', async () => {
    const engine = new WideSearchEngine(null);
    const found = await engine.searchChat(request({
      kind: 'messenger-export',
      files: [file('chat.json', {
        threadName: 'Chat', participants: ['Alice', 'Bob'],
        messages: [{ senderName: 'Alice', text: 'Lỗi rồi', timestamp: 1, type: 'text' }],
      })],
      query: 'loi',
    }));
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('Lỗi rồi');
  });

  it('skips soft-deleted messages', async () => {
    const engine = new WideSearchEngine(null);
    const all = await engine.searchChat(request({}));
    const mask = new Uint8Array(2);
    mask[all[0].idx] = 1;
    expect(await engine.searchChat(request({ deletedMask: mask }))).toEqual([]);
  });

  it('reuses a stored index for unchanged files and rebuilds when files change', async () => {
    const store = memoryStore();
    const first = new WideSearchEngine(store);
    await first.searchChat(request({}));
    expect(store.data.size).toBe(1);

    const readText = vi.fn(async () => JSON.stringify(facebookPart('never read')));
    const unchanged = file('message_1.json', facebookPart('hello needle', 'other'));
    Object.defineProperty(unchanged, 'text', { value: readText });
    const second = new WideSearchEngine(store);
    const found = await second.searchChat(request({ files: [unchanged] }));
    expect(readText).not.toHaveBeenCalled();
    expect(found.map(item => item.text)).toEqual(['hello needle']);

    const changed = file('message_1.json', facebookPart('fresh needle'), 2);
    const rebuilt = await second.searchChat(request({ files: [changed] }));
    expect(rebuilt.map(item => item.text)).toEqual(['fresh needle']);
  });

  it('builds one index for concurrent searches of the same chat', async () => {
    const engine = new WideSearchEngine(null);
    const source = file('message_1.json', facebookPart('needle'));
    const readText = vi.fn(() => Promise.resolve(JSON.stringify(facebookPart('needle'))));
    Object.defineProperty(source, 'text', { value: readText });
    await Promise.all([
      engine.searchChat(request({ files: [source] })),
      engine.searchChat(request({ files: [source], query: 'nee' })),
    ]);
    expect(readText).toHaveBeenCalledOnce();
  });

  it('keeps chats readable when the store fails', async () => {
    const broken: SearchIndexStore = {
      load: () => Promise.reject(new Error('quota')),
      save: () => Promise.reject(new Error('quota')),
      clear: () => Promise.reject(new Error('quota')),
    };
    const found = await new WideSearchEngine(broken).searchChat(request({}));
    expect(found).toHaveLength(1);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new WideSearchEngine(null).searchChat(request({}), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fingerprints files by name, size and modification time', () => {
    const a = file('message_1.json', { a: 1 }, 5);
    const b = file('message_1.json', { a: 1 }, 6);
    expect(getFilesFingerprint([a])).not.toBe(getFilesFingerprint([b]));
    expect(getFilesFingerprint([a])).toBe(getFilesFingerprint([file('message_1.json', { a: 1 }, 5)]));
  });
});

describe('IndexedDB search index store', () => {
  afterEach(async () => {
    await createIndexedDbSearchIndexStore().clear();
  });

  const entry: SearchIndexEntry = { text: 'Hi', normalized: 'hi', exact: 'hi', sender: 'A', timestamp: 1, idx: 0 };

  it('returns a saved index only for the matching fingerprint', async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.save('chat', 'fp-1', [entry]);
    expect(await store.load('chat', 'fp-1')).toEqual([entry]);
    expect(await store.load('chat', 'fp-2')).toBeNull();
    expect(await store.load('missing', 'fp-1')).toBeNull();
  });

  it('evicts the least recently saved indexes beyond its limit', async () => {
    const store = createIndexedDbSearchIndexStore({ maxEntries: 2 });
    await store.save('a', 'fp', [entry]);
    await store.save('b', 'fp', [entry]);
    await store.save('c', 'fp', [entry]);
    expect(await store.load('a', 'fp')).toBeNull();
    expect(await store.load('b', 'fp')).toEqual([entry]);
    expect(await store.load('c', 'fp')).toEqual([entry]);
  });

  it('clears every saved index', async () => {
    const store = createIndexedDbSearchIndexStore();
    await store.save('chat', 'fp', [entry]);
    await store.clear();
    expect(await store.load('chat', 'fp')).toBeNull();
  });
});
