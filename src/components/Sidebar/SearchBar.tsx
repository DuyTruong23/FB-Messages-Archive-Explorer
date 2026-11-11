import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import type { useSearch } from '../../hooks/useSearch';
import { highlightText } from '../../services/search';
import { formatInfoDate } from '../../services/storage';
import { useReactionContext } from '../../hooks/useReactionFeature';
import { useOverlayContext } from '../../hooks/useOverlay';
import { SearchFilterPanel } from './SearchFilterPanel';

export const SEARCH_DEBOUNCE_MS = 200;
const RESULT_LIST_LIMIT = 50;

interface SearchBarProps {
  search: ReturnType<typeof useSearch>;
  onJumpToMessage?: (index: number, folderName?: string) => void;
}

export function SearchBar({ search, onJumpToMessage }: SearchBarProps) {
  const reactions = useReactionContext();
  const overlay = useOverlayContext();
  const { activeQuery, results, isSearching, progress, isWideSearch, setIsWideSearch, startSearch, clearSearch } = search;
  const filterActive = !!search.filterActive;
  const normalize = search.filter?.normalize ?? true;
  const [localQuery, setLocalQuery] = useState(activeQuery);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef(false);

  const hasQuery = localQuery.trim().length > 0;
  const hasResults = results.length > 0;
  const searchDone = !isSearching && (hasQuery || filterActive) && (hasResults || progress >= 100);

  // Search the open chat while typing. "All" mode reads every chat, so it waits for Enter.
  useEffect(() => {
    if (!typedRef.current || isWideSearch) return;
    const timer = setTimeout(() => {
      if (localQuery.trim()) void startSearch(localQuery);
      else if (!filterActive) clearSearch();
      else void startSearch('');
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localQuery, isWideSearch, filterActive, startSearch, clearSearch]);

  useEffect(() => setActiveIndex(null), [results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startSearch(localQuery);
    if (e.key === 'Escape') {
      typedRef.current = false;
      setLocalQuery('');
      clearSearch();
    }
  };

  const handleClear = () => {
    typedRef.current = false;
    setLocalQuery('');
    clearSearch();
    setActiveIndex(null);
  };

  const handleResultClick = (msgIdx: number, listIdx: number, folderName?: string) => {
    setActiveIndex(listIdx);
    if (onJumpToMessage) onJumpToMessage(msgIdx, folderName);
  };

  const step = (direction: -1 | 1) => {
    if (results.length === 0) return;
    const next = activeIndex === null
      ? (direction === 1 ? 0 : results.length - 1)
      : (activeIndex + direction + results.length) % results.length;
    const item = results[next].item;
    handleResultClick(item.idx, next, item.chatFolderName);
    wrapRef.current?.querySelector(`[data-result-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className="sidebar-search" ref={wrapRef}>
      <div className="sidebar-search-row">
        <input
          ref={inputRef}
          className="sidebar-search-input"
          type="search"
          placeholder={isWideSearch ? 'Search all chats...' : 'Search current chat...'}
          value={localQuery}
          onChange={e => { typedRef.current = true; setLocalQuery(e.target.value); }}
          onKeyDown={handleKeyDown}
          aria-label="Search messages"
          id="sidebarSearchInput"
        />
        <button
          className={`sidebar-scope-btn${isWideSearch ? ' active' : ''}`}
          onClick={() => setIsWideSearch(!isWideSearch)}
          title={isWideSearch ? 'Searching all chats — click to search current chat only' : 'Searching current chat — click to search all chats'}
          aria-label="Toggle search scope"
          aria-pressed={isWideSearch}
        >
          {isWideSearch ? 'All' : 'Chat'}
        </button>
        {search.filter && (
          <button
            type="button"
            className="sidebar-scope-btn search-filter-toggle"
            aria-label="Bộ lọc tìm kiếm"
            aria-expanded={filtersOpen}
            title="Bộ lọc: người gửi, thời gian, media, link, favorite"
            onClick={() => setFiltersOpen(open => !open)}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            {(filterActive || !normalize) && <span className="dot" aria-hidden="true" />}
          </button>
        )}
        {hasQuery && (
          <button
            className="sidebar-clear-btn"
            onClick={handleClear}
            aria-label="Clear search"
            title="Clear search"
          >
            X
          </button>
        )}
      </div>

      {filtersOpen && search.filter && (
        <SearchFilterPanel
          filter={search.filter}
          onChange={search.setFilter}
          wide={isWideSearch}
          favoritesAvailable={overlay.available}
        />
      )}

      <div className={`sidebar-search-progress${isSearching ? '' : ' hidden'}`}>
        <div className="sidebar-search-progress-bar">
          <div className="sidebar-search-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="sidebar-search-progress-text">{progress < 100 ? `${progress}%` : 'Done'}</span>
      </div>

      {search.noticesFiltered && (hasQuery || filterActive) && <div className="reaction-search-hint">Likely reaction notices are excluded. <button type="button" onClick={reactions.showAll}>Show all</button></div>}

      {searchDone && results.length > 0 && (
        <div className="search-result-summary" role="status">
          <span>
            {activeIndex !== null ? `${activeIndex + 1} / ` : ''}{results.length.toLocaleString()} kết quả
            {results.length > RESULT_LIST_LIMIT ? ` (hiện ${RESULT_LIST_LIMIT} đầu tiên)` : ''}
          </span>
          <button type="button" className="search-result-nav" aria-label="Kết quả trước" onClick={() => step(-1)}>
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button type="button" className="search-result-nav" aria-label="Kết quả sau" onClick={() => step(1)}>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {searchDone && (
        <div className="sidebar-search-results" role="listbox" aria-label="Search results">
          {results.length === 0 ? (
            <div className="search-result-item search-no-results">
              No results found{isWideSearch ? ' in any chat' : ' in current chat'}.
            </div>
          ) : (
            results.slice(0, RESULT_LIST_LIMIT).map((r, i) => {
              const snippet = r.item.text.slice(0, 200);
              const highlighted = highlightText(snippet, activeQuery, normalize);
              const time = formatInfoDate(r.item.timestamp);
              return (
                <div
                  key={i}
                  className={`search-result-item${activeIndex === i ? ' active' : ''}`}
                  role="option"
                  aria-selected={activeIndex === i}
                  data-msg-idx={r.item.idx}
                  data-result-index={i}
                  data-chat-folder={r.item.chatFolderName}
                  tabIndex={0}
                  onClick={() => handleResultClick(r.item.idx, i, r.item.chatFolderName)}
                  onKeyDown={e => { if (e.key === 'Enter') handleResultClick(r.item.idx, i, r.item.chatFolderName); }}
                >
                  <div className="snippet" dangerouslySetInnerHTML={{ __html: highlighted }} />
                  <div className="meta">
                    {r.item.sender} · {time}
                  </div>
                  {r.item.chatTitle && (
                    <div className="meta">
                      {r.item.chatTitle}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
