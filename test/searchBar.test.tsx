// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchBar } from '../src/components/Sidebar/SearchBar';
import type { useSearch } from '../src/hooks/useSearch';
import { DEFAULT_SEARCH_FILTER } from '../src/services/searchFilters';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SearchBar', () => {
  it('limits rendered results and jumps to the keyboard-selected message and chat', () => {
    const startSearch = vi.fn();
    const onJumpToMessage = vi.fn();
    const search = {
      activeQuery: 'needle',
      results: Array.from({ length: 60 }, (_, index) => ({
        item: {
          text: `needle ${index}`,
          normalized: `needle ${index}`,
          sender: 'Alice',
          timestamp: index,
          idx: 100 + index,
          chatTitle: `Chat ${index}`,
          chatFolderName: `chat-${index}`,
        },
      })),
      isSearching: false,
      progress: 100,
      isWideSearch: true,
      setIsWideSearch: vi.fn(),
      startSearch,
      clearSearch: vi.fn(),
      clearWideSearchCache: vi.fn(),
    } as ReturnType<typeof useSearch>;
    render(<SearchBar search={search} onJumpToMessage={onJumpToMessage} />);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(50);
    fireEvent.keyDown(options[12], { key: 'Enter' });
    expect(onJumpToMessage).toHaveBeenCalledWith(112, 'chat-12');
    expect(options[12].getAttribute('aria-selected')).toBe('true');

    const input = screen.getByRole('searchbox', { name: 'Search messages' });
    fireEvent.change(input, { target: { value: 'next query' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(startSearch).toHaveBeenCalledWith('next query');
  });

  it('searches the open chat 200 ms after typing and steps through results', () => {
    vi.useFakeTimers();
    const startSearch = vi.fn();
    const onJumpToMessage = vi.fn();
    const search = {
      activeQuery: 'loi',
      filter: DEFAULT_SEARCH_FILTER,
      setFilter: vi.fn(),
      filterActive: false,
      hasSearched: true,
      results: [10, 20, 30].map(idx => ({ item: { text: `lỗi ${idx}`, normalized: `loi ${idx}`, sender: 'A', timestamp: idx, idx } })),
      isSearching: false,
      progress: 100,
      isWideSearch: false,
      noticesFiltered: false,
      setIsWideSearch: vi.fn(),
      startSearch,
      clearSearch: vi.fn(),
      clearWideSearchCache: vi.fn(),
    } as ReturnType<typeof useSearch>;
    render(<SearchBar search={search} onJumpToMessage={onJumpToMessage} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search messages' }), { target: { value: 'lỗi' } });
    vi.advanceTimersByTime(199);
    expect(startSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(startSearch).toHaveBeenCalledWith('lỗi');

    expect(screen.getByRole('status').textContent).toContain('3 kết quả');
    expect(screen.getAllByRole('option')[0].innerHTML).toContain('<span class="search-highlight">lỗi</span>');
    fireEvent.click(screen.getByRole('button', { name: 'Kết quả sau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kết quả sau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kết quả trước' }));
    expect(onJumpToMessage.mock.calls.map(call => call[0])).toEqual([10, 20, 10]);
    expect(screen.getByRole('status').textContent).toContain('1 / 3 kết quả');
  });
});
