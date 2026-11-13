import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatListEntry, MessengerThread, SearchIndexEntry, SearchResult } from '../types/messenger';
import type { ReadableDirectoryHandle } from '../types/fileSystem';
import { buildSearchIndex, performSearch, type SearchOptions } from '../services/search';
import type { SearchFilter } from '../types/overlay';
import { DEFAULT_SEARCH_FILTER, isSearchFilterActive } from '../services/searchFilters';
import { isReactionNoticeMessage } from '../services/reactions';
import { mapWithConcurrency } from '../services/concurrency';
import { getWideSearchClient } from '../services/wideSearch/wideSearchClient';
import {
  collectChatSearchFiles,
  getWideSearchChatKey,
  getWideSearchChatKind,
} from '../services/wideSearch/chatSearchFiles';

/** Chats read and indexed at once; parsing itself is serialized in the search worker. */
const WIDE_SEARCH_CONCURRENCY = 3;
/** Minimum gap between partial "All" result updates. */
const WIDE_RESULTS_PUBLISH_MS = 150;

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
        const client = getWideSearchClient();
        const total = archiveList.length;
        const byChat: SearchResult[][] = new Array(total);
        let done = 0;
        let lastPublish = 0;
        const publish = () => {
          lastPublish = performance.now();
          setResults(byChat.flat());
        };

        await mapWithConcurrency(archiveList, WIDE_SEARCH_CONCURRENCY, async (entry, i) => {
          try {
            const files = await collectChatSearchFiles(entry, signal);
            const isOpenChat = !!currentOverlay?.sourceFile && entry._messengerExport
              && entry._jsonFileName === currentOverlay.sourceFile && entry.dirHandle === currentOverlay.directory;
            const items = await client.searchChat({
              key: getWideSearchChatKey(entry, hideNotices),
              kind: getWideSearchChatKind(entry),
              files,
              hideNotices,
              query: searchQuery,
              normalize: filter.normalize !== false,
              deletedMask: isOpenChat ? currentOverlay.deletedMask : undefined,
            }, signal);
            if (signal.aborted) return;
            byChat[i] = items.map(item => ({
              item: { ...item, chatTitle: entry.title, chatFolderName: entry.folderName },
            }));
          } catch (e: any) {
            if (e?.name === 'AbortError' || signal.aborted) throw e;
          }
          if (signal.aborted) return;
          done++;
          setProgress(Math.round((done / total) * 100));
          if (byChat[i]?.length && performance.now() - lastPublish >= WIDE_RESULTS_PUBLISH_MS) publish();
        }, signal);
        if (signal.aborted) return;
        publish();
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
    getWideSearchClient().clearMemory();
  }, []);

  return { filter, setFilter, filterActive, hasSearched, noticesFiltered: hideNotices && !standalone, activeQuery, results, isSearching, progress, isWideSearch, setIsWideSearch, startSearch, clearSearch, clearWideSearchCache };
}
