import { beforeAll, describe, expect, it } from 'vitest';
import type * as searchModule from '../src/services/search';
import type { MessengerMessage } from '../src/types/messenger';
import type { SearchFilter } from '../src/types/overlay';
import { DEFAULT_SEARCH_FILTER, getMonthRange, getPresetRange, getYearRange, isSearchFilterActive } from '../src/services/searchFilters';

let search: typeof searchModule;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { hostname: 'test' } }, configurable: true });
  search = await import('../src/services/search');
});

const day = (date: number, hour = 12) => new Date(2025, 9, date, hour).getTime();

const messages: MessengerMessage[] = [
  { sender_name: 'Quoc Duy', timestamp_ms: day(1), content: 'App bị lỗi rồi' },
  { sender_name: 'Thanh Dii', timestamp_ms: day(5), content: 'LỖI gì vậy' },
  { sender_name: 'Quoc Duy', timestamp_ms: day(10), content: 'loi mang', photos: [{ uri: './media/a.jpeg' }] },
  { sender_name: 'Thanh Dii', timestamp_ms: day(15), content: 'xem https://example.com/loi' },
  { sender_name: 'Quoc Duy', timestamp_ms: day(20), content: 'lôi ra đi' },
  { sender_name: 'Thanh Dii', timestamp_ms: day(25), content: '', failedMediaCount: 1 },
];

async function run(query: string, filter: Partial<SearchFilter> = {}, extra: Omit<searchModule.SearchOptions, 'filter'> = {}) {
  const index = search.buildSearchIndex(messages, () => false);
  const results = await search.performSearch(query, index, undefined, undefined, {
    filter: { ...DEFAULT_SEARCH_FILTER, ...filter }, ...extra,
  });
  return results.map(result => result.item.idx);
}

describe('search filters', () => {
  it('matches accent-insensitively by default', async () => {
    expect(await run('loi')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await run('LỖI')).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('requires matching accents when normalize is off', async () => {
    expect(await run('lỗi', { normalize: false })).toEqual([0, 1, 5]);
    expect(await run('loi', { normalize: false })).toEqual([2, 3]);
  });

  it('filters by sender', async () => {
    expect(await run('loi', { senders: ['Quoc Duy'] })).toEqual([0, 2, 4]);
    expect(await run('loi', { senders: ['Quoc Duy', 'Thanh Dii'] })).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('filters by an inclusive date range', async () => {
    expect(await run('loi', { from: day(5), to: day(15) })).toEqual([1, 2, 3]);
    expect(await run('loi', { from: day(11) })).toEqual([3, 4, 5]);
    expect(await run('loi', { to: day(4) })).toEqual([0]);
  });

  it('combines sender, date range and normalize', async () => {
    expect(await run('lỗi', { senders: ['Quoc Duy'], from: day(2), to: day(21) })).toEqual([2, 4]);
    expect(await run('lỗi', { senders: ['Quoc Duy'], from: day(2), to: day(21), normalize: false })).toEqual([]);
  });

  it('filters by media, link and favorite', async () => {
    expect(await run('', { hasMedia: true })).toEqual([2, 5]);
    expect(await run('', { hasLink: true })).toEqual([3]);
    expect(await run('', { favoritesOnly: true }, { favoriteIndices: new Set([1, 4]) })).toEqual([1, 4]);
    expect(await run('loi', { favoritesOnly: true })).toEqual([]);
  });

  it('skips soft-deleted messages', async () => {
    const deletedMask = new Uint8Array(messages.length);
    deletedMask[0] = 1;
    deletedMask[4] = 1;
    expect(await run('loi', {}, { deletedMask })).toEqual([1, 2, 3, 5]);
  });

  it('finds failed media by its label', async () => {
    expect(await run('media tai loi')).toEqual([5]);
  });

  it('returns nothing for an empty query without filters', async () => {
    expect(await run('')).toEqual([]);
    expect(isSearchFilterActive(DEFAULT_SEARCH_FILTER)).toBe(false);
    expect(isSearchFilterActive({ ...DEFAULT_SEARCH_FILTER, normalize: false })).toBe(false);
  });

  it('builds preset, month and year ranges in local time', () => {
    const now = new Date(2025, 9, 11, 23, 16).getTime();
    expect(getPresetRange('today', now)).toEqual({
      from: new Date(2025, 9, 11).getTime(), to: new Date(2025, 9, 12).getTime() - 1,
    });
    expect(getPresetRange('7d', now).from).toBe(new Date(2025, 9, 5).getTime());
    expect(getPresetRange('30d', now).from).toBe(new Date(2025, 8, 12).getTime());
    expect(getMonthRange(2025, 12)).toEqual({
      from: new Date(2025, 11, 1).getTime(), to: new Date(2026, 0, 1).getTime() - 1,
    });
    expect(getYearRange(2025)).toEqual({
      from: new Date(2025, 0, 1).getTime(), to: new Date(2026, 0, 1).getTime() - 1,
    });
  });
});
