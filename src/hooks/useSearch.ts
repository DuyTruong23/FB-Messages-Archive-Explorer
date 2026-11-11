import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatListEntry, MessengerThread, SearchIndexEntry, SearchResult } from '../types/messenger';
import type { ReadableDirectoryHandle } from '../types/fileSystem';
import { buildSearchIndex, performSearch, type SearchOptions } from '../services/search';
import type { SearchFilter } from '../types/overlay';
import { DEFAULT_SEARCH_FILTER, isSearchFilterActive } from '../services/searchFilters';
import { isReactionNoticeMessage } from '../services/reactions';
import { loadChatMessages } from '../services/fileSystem';
import { loadMessengerExportChat } from '../services/messengerExport';

const WIDE_INDEX_CACHE_LIMIT = 50;
const globalWideIndexCache = new Map<string, { dirHandle: ReadableDirectoryHandle; index: SearchIndexEntry[] }>();

function getWideIndexCacheKey(entry: ChatListEntry, hide = true): string {
  return `${entry.source}:${entry.folderName}:${entry._jsonFileName || ''}:${hide && !entry._messengerExport}`;
}

function getCachedWideIndex(entry: ChatListEntry, hide: boolean): SearchIndexEntry[] | null {
  const key = getWideIndexCacheKey(entry, hide);
  const cached = globalWideIndexCache.get(key);
  if (!cached || cached.dirHandle !== entry.dirHandle) {
    if (cached) globalWideIndexCache.delete(key);
    return null;
  }

  globalWideIndexCache.delete(key);
  globalWideIndexCache.set(key, cached);
  return cached.index;
}

function setCachedWideIndex(entry: ChatListEntry, index: SearchIndexEntry[], hide: boolean) {
  const key = getWideIndexCacheKey(entry, hide);
  globalWideIndexCache.delete(key);
  globalWideIndexCache.set(key, { dirHandle: entry.dirHandle, index });

  while (globalWideIndexCache.size > WIDE_INDEX_CACHE_LIMIT) {
    const oldestKey = globalWideIndexCache.keys().next().value;
    if (!oldestKey) break;
    globalWideIndexCache.delete(oldestKey);
  }
}

export interface SearchOverlayState {
  deletedMask: Uint8Array;
  favoriteIndices: ReadonlySet<number>;
  /** The open conversation; its deleted messages are skipped in "All" results too. */
  sourceFile?: string;
  directory?: ReadableDirectoryHandle;
}

export function useSearch(
  chatData: MessengerThread | null,
  archiveList: ChatListEntry[],
  hideNotices = true,
  standalone = false,
  overlay?: SearchOverlayState
): {
  activeQuery: string;
  filter: SearchFilter;
  setFilter: (filter: SearchFilter) => void;
  /** Filters other than "normalize" narrow results; in "All" mode only normalize applies. */
  filterActive: boolean;
  /** True after a search ran, including a filter-only search with an empty query. */
  hasSearched: boolean;
  results: SearchResult[];
  isSearching: boolean;
  progress: number;
  isWideSearch: boolean;
  noticesFiltered: boolean;
  setIsWideSearch: (wide: boolean) => void;
  startSearch: (q: string) => Promise<void>;
  clearSearch: () => void;
  clearWideSearchCache: () => void;
} {
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isWideSearch, setIsWideSearch] = useState(false);
  const [filter, setFilter] = useState<SearchFilter>(DEFAULT_SEARCH_FILTER);
  const [hasSearched, setHasSearched] = useState(false);
  const filterActive = !isWideSearch && isSearchFilterActive(filter);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  const indexCacheRef = useRef<{ data: MessengerThread | null; index: SearchIndexEntry[] }>({
    data: null,
    index: [],
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (chatData !== indexCacheRef.current.data) {
      indexCacheRef.current = { data: chatData, index: [] };
    }
  }, [chatData]);

  // Build the open chat's index while the browser is idle so the first search
  // does not pay for normalizing every message (about 0.2 s for 49k messages).
  useEffect(() => {
    if (!chatData?.messages?.length) return;
    const build = () => {
      if (indexCacheRef.current.data === chatData && indexCacheRef.current.index.length) return;
      indexCacheRef.current = {
        data: chatData,
        index: buildSearchIndex(chatData.messages, hideNotices && !standalone ? isReactionNoticeMessage : () => false),
      };
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(build, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(build, 1000);
    return () => clearTimeout(timer);
  }, [chatData, hideNotices, standalone]);

  const startSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() && !filterActive) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    setIsSearching(true);
    setProgress(0);
    setResults([]);
    setActiveQuery(searchQuery);
    setHasSearched(true);
    const currentOverlay = overlayRef.current;
    const overlayMatches = !!currentOverlay && !!chatData
      && currentOverlay.deletedMask.length === chatData.messages.length;

    try {
      if (!isWideSearch) {
        if (!chatData?.messages) {
          setIsSearching(false);
          return;
        }
        if (indexCacheRef.current.data !== chatData || !indexCacheRef.current.index.length) {
          indexCacheRef.current = {
            data: chatData,
            index: buildSearchIndex(chatData.messages, hideNotices && !standalone ? isReactionNoticeMessage : () => false),
          };
        }
        if (signal.aborted) return;
        const options: SearchOptions = {
          filter,
          deletedMask: overlayMatches ? currentOverlay.deletedMask : undefined,
          favoriteIndices: currentOverlay?.favoriteIndices,
        };
        const found = await performSearch(searchQuery, indexCacheRef.current.index, setProgress, signal, options);
        if (signal.aborted) return;
        setResults(found);
      } else {
        const allResults: SearchResult[] = [];
        const total = archiveList.length;

        for (let i = 0; i < archiveList.length; i++) {
          if (signal.aborted) return;
          const entry = archiveList[i];
          try {
            let index = getCachedWideIndex(entry, hideNotices);
            if (!index) {
              const data = entry._messengerExport
                ? await loadMessengerExportChat(entry.dirHandle, entry._jsonFileName!, undefined, signal)
                : await loadChatMessages(entry.dirHandle, undefined, signal);
              if (signal.aborted) return;
              index = buildSearchIndex(data.messages, hideNotices && !entry._messengerExport ? isReactionNoticeMessage : () => false);
              setCachedWideIndex(entry, index, hideNotices);
            }
            const isOpenChat = !!currentOverlay?.sourceFile && entry._messengerExport
              && entry._jsonFileName === currentOverlay.sourceFile && entry.dirHandle === currentOverlay.directory;
            const found = await performSearch(searchQuery, index, undefined, signal, {
              filter: { ...DEFAULT_SEARCH_FILTER, normalize: filter.normalize },
              deletedMask: isOpenChat ? currentOverlay.deletedMask : undefined,
            });
            if (signal.aborted) return;
            
            found.forEach(r => {
              allResults.push({
                item: {
                  ...r.item,
                  chatTitle: entry.title,
                  chatFolderName: entry.folderName,
                },
              });
            });
          } catch (e: any) {
            if (e.name === 'AbortError') throw e;
          }
          if (signal.aborted) return;
          setProgress(Math.round(((i + 1) / total) * 100));
        }
        setResults(allResults);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return;
      }
      console.error(e);
    } finally {
      if (!signal.aborted) {
        setIsSearching(false);
        setProgress(100);
      }
    }
  }, [isWideSearch, chatData, archiveList, hideNotices, standalone, filter, filterActive]);

  const previousVisibility = useRef(`${hideNotices}:${standalone}`);
  useEffect(() => {
    const visibility = `${hideNotices}:${standalone}`;
    if (visibility === previousVisibility.current) return;
    previousVisibility.current = visibility;
    abortControllerRef.current?.abort();
    indexCacheRef.current = { data: chatData, index: [] };
    if (activeQuery) void startSearch(activeQuery);
  }, [hideNotices, standalone, chatData, activeQuery, startSearch]);

  // Re-run the current search when filters, deletions or favorites change.
  const rerunKey = useRef({ filter, deletedMask: overlay?.deletedMask, favorites: overlay?.favoriteIndices });
  useEffect(() => {
    const previous = rerunKey.current;
    const next = { filter, deletedMask: overlay?.deletedMask, favorites: overlay?.favoriteIndices };
    rerunKey.current = next;
    if (previous.filter === next.filter && previous.deletedMask === next.deletedMask && previous.favorites === next.favorites) return;
    if (isWideSearch && previous.filter.normalize === next.filter.normalize) return;
    if (activeQuery.trim() || filterActive) void startSearch(activeQuery);
    else if (hasSearched) {
      abortControllerRef.current?.abort();
      setResults([]);
      setHasSearched(false);
    }
  }, [filter, overlay?.deletedMask, overlay?.favoriteIndices, activeQuery, filterActive, isWideSearch, hasSearched, startSearch]);

  const clearSearch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setHasSearched(false);
    setActiveQuery('');
    setResults([]);
    setProgress(0);
    setIsSearching(false);
  }, []);

  const clearWideSearchCache = useCallback(() => {
    globalWideIndexCache.clear();
  }, []);

  return { filter, setFilter, filterActive, hasSearched, noticesFiltered: hideNotices && !standalone, activeQuery, results, isSearching, progress, isWideSearch, setIsWideSearch, startSearch, clearSearch, clearWideSearchCache };
}
