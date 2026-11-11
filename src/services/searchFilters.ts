import type { SearchIndexEntry } from '../types/messenger';
import type { SearchFilter } from '../types/overlay';

export const DEFAULT_SEARCH_FILTER: SearchFilter = {
  senders: [],
  from: null,
  to: null,
  normalize: true,
  hasMedia: false,
  hasLink: false,
  favoritesOnly: false,
};

/** The normalize toggle changes how text matches; it does not narrow results by itself. */
export function isSearchFilterActive(filter: SearchFilter): boolean {
  return filter.senders.length > 0
    || filter.from !== null
    || filter.to !== null
    || filter.hasMedia
    || filter.hasLink
    || filter.favoritesOnly;
}

export function matchesSearchFilter(
  entry: Pick<SearchIndexEntry, 'sender' | 'timestamp' | 'idx' | 'hasMedia' | 'hasLink'>,
  filter: SearchFilter,
  favoriteIndices?: ReadonlySet<number>
): boolean {
  if (filter.senders.length > 0 && !filter.senders.includes(entry.sender)) return false;
  if (filter.from !== null && entry.timestamp < filter.from) return false;
  if (filter.to !== null && entry.timestamp > filter.to) return false;
  if (filter.hasMedia && !entry.hasMedia) return false;
  if (filter.hasLink && !entry.hasLink) return false;
  if (filter.favoritesOnly && !favoriteIndices?.has(entry.idx)) return false;
  return true;
}

export type DatePreset = 'today' | '7d' | '30d';

export interface DateRange {
  from: number;
  to: number;
}

/** Ranges use local time and end at the last millisecond of today. */
export function getPresetRange(preset: DatePreset, now = Date.now()): DateRange {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  if (preset === '7d') start.setDate(start.getDate() - 6);
  else if (preset === '30d') start.setDate(start.getDate() - 29);
  return { from: start.getTime(), to: end.getTime() - 1 };
}

/** `month` is 1-12. */
export function getMonthRange(year: number, month: number): DateRange {
  return {
    from: new Date(year, month - 1, 1).getTime(),
    to: new Date(year, month, 1).getTime() - 1,
  };
}

export function getYearRange(year: number): DateRange {
  return {
    from: new Date(year, 0, 1).getTime(),
    to: new Date(year + 1, 0, 1).getTime() - 1,
  };
}
