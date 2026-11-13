// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatListEntry, MessengerThread } from '../src/types/messenger';
import { createMockDirectoryHandle } from './helpers/mockFileSystem';

// jsdom's Blob has no text(); browsers and the search worker do.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

const serviceMocks = vi.hoisted(() => ({ collectChatSearchFiles: vi.fn() }));

vi.mock('../src/services/wideSearch/chatSearchFiles', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/services/wideSearch/chatSearchFiles')>();
  serviceMocks.collectChatSearchFiles.mockImplementation(actual.collectChatSearchFiles);
  return { ...actual, collectChatSearchFiles: serviceMocks.collectChatSearchFiles };
});

import { useSearch } from '../src/hooks/useSearch';
import { getWideSearchClient } from '../src/services/wideSearch/wideSearchClient';

function part(content: string): string {
  return JSON.stringify({ participants: [{ name: 'Alice' }], messages: [{ sender_name: 'Alice', timestamp_ms: 1, content }] });
}

function entry(name: string, content?: string): ChatListEntry {
  return {
    folderName: name,
    title: `${name} title`,
    participants: [],
    messageCount: 1,
    folderSize: 0,
    dirHandle: createMockDirectoryHandle(name, content === undefined ? {} : { 'message_1.json': part(content) }),
    jsonFileCount: 1,
    source: 'inbox',
  };
}

function thread(content: string, count = 1): MessengerThread {
  return {
    title: 'Thread', participants: [{ name: 'Alice' }],
    messages: Array.from({ length: count }, (_, index) => ({
      sender_name: 'Alice', timestamp_ms: index + 1, content,
    })),
  };
}

afterEach(async () => {
  serviceMocks.collectChatSearchFiles.mockClear();
  await getWideSearchClient().clearAll();
});

describe('search hook lifecycle', () => {
  it('publishes complete current-chat results and clears all observable search state', async () => {
    const { result } = renderHook(() => useSearch(thread('needle', 60), []));

    await act(async () => { await result.current.startSearch('needle'); });
    expect(result.current.results).toHaveLength(60);
    expect(result.current.progress).toBe(100);
    expect(result.current.activeQuery).toBe('needle');

    act(() => result.current.clearSearch());
    expect(result.current).toMatchObject({ activeQuery: '', results: [], progress: 0, isSearching: false });
  });

  it('attributes wide results to their chats and continues past an unreadable chat', async () => {
    const unreadable = entry('unreadable');
    const readable = entry('readable', 'needle');
    const { result } = renderHook(() => useSearch(null, [unreadable, readable]));
    act(() => result.current.setIsWideSearch(true));

    await act(async () => { await result.current.startSearch('needle'); });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].item).toMatchObject({
      chatTitle: 'readable title', chatFolderName: 'readable',
    });
    expect(result.current.progress).toBe(100);
  });

  it('keeps wide results in chat-list order', async () => {
    const chats = ['a', 'b', 'c', 'd', 'e'].map(name => entry(name, `${name} needle`));
    const { result } = renderHook(() => useSearch(null, chats));
    act(() => result.current.setIsWideSearch(true));

    await act(async () => { await result.current.startSearch('needle'); });

    expect(result.current.results.map(found => found.item.chatFolderName)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not publish a wide-search result that resolves after cancellation', async () => {
    const chat = entry('slow', 'needle');
    let release!: (files: File[]) => void;
    serviceMocks.collectChatSearchFiles.mockImplementationOnce(() => new Promise<File[]>(resolve => { release = resolve; }));
    const { result } = renderHook(() => useSearch(null, [chat]));
    act(() => result.current.setIsWideSearch(true));
    let searching!: Promise<void>;
    act(() => { searching = result.current.startSearch('needle'); });
    await waitFor(() => expect(serviceMocks.collectChatSearchFiles).toHaveBeenCalledOnce());

    act(() => result.current.clearSearch());
    release([new File([part('needle')], 'message_1.json')]);
    await act(async () => { await searching; });

    expect(result.current).toMatchObject({ activeQuery: '', results: [], progress: 0, isSearching: false });
  });

  it('aborts an older search before publishing the replacement results', async () => {
    const chat = entry('replace', 'replacement needle');
    let releaseFirst!: (files: File[]) => void;
    serviceMocks.collectChatSearchFiles.mockImplementationOnce(() => new Promise<File[]>(resolve => { releaseFirst = resolve; }));
    const { result } = renderHook(() => useSearch(null, [chat]));
    act(() => result.current.setIsWideSearch(true));
    let first!: Promise<void>;
    act(() => { first = result.current.startSearch('old'); });
    await waitFor(() => expect(serviceMocks.collectChatSearchFiles).toHaveBeenCalledOnce());

    let second!: Promise<void>;
    act(() => { second = result.current.startSearch('replacement'); });
    releaseFirst([new File([part('old needle')], 'message_1.json')]);
    await act(async () => { await Promise.all([first, second]); });

    expect(result.current.activeQuery).toBe('replacement');
    expect(result.current.results.map(found => found.item.text)).toEqual(['replacement needle']);
    expect(result.current.isSearching).toBe(false);
  });

  it('rebuilds a cached wide index when the chat files change', async () => {
    const first = entry('same-folder', 'first needle');
    const second = entry('same-folder', 'second needle!');
    const { result, rerender } = renderHook(
      ({ archive }) => useSearch(null, archive),
      { initialProps: { archive: [first] } },
    );
    act(() => result.current.setIsWideSearch(true));
    await act(async () => { await result.current.startSearch('needle'); });
    expect(result.current.results[0].item.text).toBe('first needle');

    rerender({ archive: [second] });
    await act(async () => { await result.current.startSearch('needle'); });
    expect(result.current.results[0].item.text).toBe('second needle!');

    act(() => result.current.clearWideSearchCache());
    await act(async () => { await result.current.startSearch('needle'); });
    expect(result.current.results[0].item.text).toBe('second needle!');
  });
});
