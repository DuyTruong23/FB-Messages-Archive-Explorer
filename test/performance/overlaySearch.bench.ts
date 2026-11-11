import { beforeAll, bench, describe } from 'vitest';
import type * as searchModule from '../../src/services/search';
import { getMessageIds } from '../../src/services/messageId';
import { applyOverlay, createEmptyOverlay } from '../../src/services/overlay';
import { DEFAULT_SEARCH_FILTER } from '../../src/services/searchFilters';
import { parseMessengerExportJson } from '../../src/services/messengerExport/messengerExportParser';

// Size of the largest known real thread: about 49k messages and 6k media items.
const COUNT = 49_000;
const words = ['lỗi', 'mạng', 'đường', 'hôm nay', 'ăn cơm', 'chưa', 'ok', 'Đi chơi', 'ảnh', 'video'];
const raw = JSON.stringify({
  threadName: 'Thanh Dii',
  participants: ['Quoc Duy', 'Thanh Dii'],
  messages: Array.from({ length: COUNT }, (_, index) => ({
    isUnsent: index % 997 === 0,
    media: index % 8 === 0 ? [{ uri: `./media/${index}.jpeg` }] : [],
    reactions: [],
    senderName: index % 2 ? 'Quoc Duy' : 'Thanh Dii',
    text: `${words[index % words.length]} ${words[(index * 7) % words.length]} tin nhắn số ${index}`,
    timestamp: 1_760_199_384_846 - index * 61_000,
    type: index % 8 === 0 ? 'media' : 'text',
  })),
});

let search: typeof searchModule;
let thread: ReturnType<typeof parseMessengerExportJson>;
let index: ReturnType<typeof searchModule.buildSearchIndex>;
let ids: string[];
let deletedMask: Uint8Array;
const benchOptions = { time: 1_000, warmupTime: 200 };

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { hostname: 'test' } }, configurable: true });
  search = await import('../../src/services/search');
  thread = parseMessengerExportJson(raw);
  index = search.buildSearchIndex(thread.messages, () => false);
  ids = getMessageIds(thread.messages);
  deletedMask = applyOverlay(ids, { ...createEmptyOverlay('t.json'), deleted: ids.filter((_, i) => i % 50 === 0) }).deletedMask;
});

describe('49k-message thread', () => {
  bench('parse export JSON', () => { parseMessengerExportJson(raw); }, benchOptions);
  bench('compute message ids', () => { getMessageIds(thread.messages); }, benchOptions);
  bench('apply overlay (980 deleted)', () => {
    applyOverlay(ids, { ...createEmptyOverlay('t.json'), deleted: ids.filter((_, i) => i % 50 === 0) });
  }, benchOptions);
  bench('build search index', () => { search.buildSearchIndex(thread.messages, () => false); }, benchOptions);
  bench('search "loi" (normalized, skip deleted)', async () => {
    await search.performSearch('loi', index, undefined, undefined, { filter: DEFAULT_SEARCH_FILTER, deletedMask });
  }, benchOptions);
  bench('search with sender + date filters', async () => {
    await search.performSearch('duong', index, undefined, undefined, {
      filter: { ...DEFAULT_SEARCH_FILTER, senders: ['Quoc Duy'], from: 1_758_000_000_000, to: 1_760_000_000_000 },
      deletedMask,
    });
  }, benchOptions);
});
