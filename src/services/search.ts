import type { MessengerMessage, SearchIndexEntry, SearchResult } from '../types/messenger';
import type { SearchFilter } from '../types/overlay';
import { isSearchFilterActive, matchesSearchFilter } from './searchFilters';
import { getMessageLinks } from './messageLinks';
import { escapeHtml } from './storage';
import { fixEncoding } from './parser';
import { isReactionNoticeMessage } from './reactions';
import { getMessageBump } from './messageBump';


function buildNormalizedMap(original: string, normalize: boolean): { normalized: string; mapping: number[] } {
  const mapping: number[] = [];
  let normalized = '';
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    const n = normalize ? foldDiacritics(ch) : ch;
    for (let k = 0; k < n.length; k++) {
      mapping.push(i);
      normalized += n[k];
    }
  }
  return { normalized: normalized.toLowerCase(), mapping };
}

function findRangesForToken(original: string, tokenNorm: string, normalize: boolean): [number, number][] {
  const { normalized, mapping } = buildNormalizedMap(original, normalize);
  const ranges: [number, number][] = [];
  let start = 0;
  while (true) {
    const idx = normalized.indexOf(tokenNorm, start);
    if (idx === -1) break;
    const origStart = mapping[idx];
    const origEnd = mapping[idx + tokenNorm.length - 1] + 1;
    ranges.push([origStart, origEnd]);
    start = idx + tokenNorm.length;
  }
  return ranges;
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (!ranges.length) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [ranges[0].slice() as [number, number]];
  for (let i = 1; i < ranges.length; i++) {
    const cur = ranges[i];
    const last = out[out.length - 1];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      out.push(cur.slice() as [number, number]);
    }
  }
  return out;
}

function getMessageText(msg: MessengerMessage): string {
  return fixEncoding(msg?.text || msg?.content || '').trim();
}


/** Strip combining marks and fold Vietnamese "đ", which NFD does not decompose. */
function foldDiacritics(str: string): string {
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** Accent-insensitive form: "lỗi", "LỖI" and "lôi" all become "loi". */
export function normalizeForSearch(str: string): string {
  if (!str) return '';
  return foldDiacritics(str).toLowerCase().replace(/\s+/g, ' ').trim();
}

export const normalize = normalizeForSearch;

/** Case- and whitespace-insensitive form that keeps diacritics. */
export function foldCaseForSearch(str: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function highlightText(original: string, query: string, normalize = true): string {
  if (!query || !original) return escapeHtml(original);
  const qNorm = normalize ? normalizeForSearch(query) : foldCaseForSearch(query);
  if (!qNorm) return escapeHtml(original);
  const allRanges = findRangesForToken(original, qNorm, normalize);
  if (!allRanges.length) return escapeHtml(original);
  const merged = mergeRanges(allRanges);
  let out = '';
  let lastIdx = 0;
  for (const [s, e] of merged) {
    out += escapeHtml(original.slice(lastIdx, s));
    out += '<span class="search-highlight">' + escapeHtml(original.slice(s, e)) + '</span>';
    lastIdx = e;
  }
  out += escapeHtml(original.slice(lastIdx));
  return out;
}

export const FAILED_MEDIA_LABEL = 'Media tải lỗi';

export interface SearchOptions {
  filter?: SearchFilter;
  /** 1 where the message index is soft deleted; such messages never match. */
  deletedMask?: Uint8Array;
  favoriteIndices?: ReadonlySet<number>;
}

export function buildSearchIndex(
  messages: MessengerMessage[],
  isReactionNotice: (msg: MessengerMessage) => boolean = isReactionNoticeMessage
): SearchIndexEntry[] {
  const idx: SearchIndexEntry[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (isReactionNotice(m)) continue;

    const parts: string[] = [];
    const messageText = getMessageText(m);
    if (messageText) parts.push(messageText);
    const bump = getMessageBump(m);
    if (bump) {
      parts.push(bump.label);
      if (bump.text && bump.text !== messageText) parts.push(bump.text);
    }

    const mediaArrays = [
      m.photos,
      m.videos,
      m.audio,
      m.audio_files,
      m.gifs,
      m.files,
      m.media,
    ];

    for (const arr of mediaArrays) {
      if (arr) {
        for (const item of arr) {
          const name = item.filename || item.name || item.path || item.uri;
          if (name) {
            const decoded = fixEncoding(name);
            const baseName = decoded.split(/[/\\]/).pop();
            if (baseName) parts.push(baseName);
          }
        }
      }
    }

    let hasMedia = !!m.sticker || !!m.failedMediaCount;
    for (const arr of mediaArrays) if (arr?.length) hasMedia = true;
    // Failed downloads have no file name; index a label so they stay findable.
    if (m.failedMediaCount) parts.push(FAILED_MEDIA_LABEL);

    const text = parts.join(' ');
    idx.push({
      text,
      normalized: normalizeForSearch(text),
      exact: foldCaseForSearch(text),
      hasMedia,
      hasLink: getMessageLinks(m).length > 0,
      sender: m.senderName || m.sender_name || 'Unknown',
      timestamp: m.timestamp_ms || m.timestamp || 0,
      idx: i,
    });
  }
  return idx;
}

export async function performSearch(
  query: string,
  index: SearchIndexEntry[],
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const { filter, deletedMask, favoriteIndices } = options;
  const useNormalized = filter?.normalize !== false;
  const normalizedQuery = useNormalized ? normalizeForSearch(query) : foldCaseForSearch(query);
  const filterActive = !!filter && isSearchFilterActive(filter);
  // Filters alone are a valid search: "every favorite from Alice in March".
  if (!normalizedQuery && !filterActive) return results;

  let lastYieldTime = performance.now();
  const YIELD_INTERVAL_MS = 15;

  for (let i = 0; i < index.length; i++) {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    const item = index[i];
    if (
      !deletedMask?.[item.idx]
      && (!filterActive || matchesSearchFilter(item, filter!, favoriteIndices))
      && (!normalizedQuery || (useNormalized ? item.normalized : item.exact ?? foldCaseForSearch(item.text)).includes(normalizedQuery))
    ) {
      results.push({ item });
    }

    if (i % 500 === 0) {
      const now = performance.now();
      if (now - lastYieldTime > YIELD_INTERVAL_MS) {
        if (onProgress) onProgress(Math.min(100, Math.round(((i + 1) / index.length) * 100)));
        await new Promise<void>(r => setTimeout(r, 0));
        lastYieldTime = performance.now();
      }
    }
  }

  if (onProgress) onProgress(100);
  return results;
}
