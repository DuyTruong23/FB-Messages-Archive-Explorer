// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_AUTOSAVE_MS, OverlayContext, useOverlay } from '../src/hooks/useOverlay';
import { MessageSelectionContext, selectRange, useMessageSelection } from '../src/hooks/useMessageSelection';
import { MessageList } from '../src/components/Chat/MessageList';
import { getMessageIds } from '../src/services/messageId';
import { parseMessengerExportJson } from '../src/services/messengerExport/messengerExportParser';
import { createMediaState } from '../src/services/media';
import { formatChatTimestamp } from '../src/services/dateTime';
import type { ChatListEntry, MessengerThread } from '../src/types/messenger';
import type { ReadableDirectoryHandle } from '../src/types/fileSystem';
import type { Settings } from '../src/hooks/useSettings';
import { createMockDirectoryHandle } from './helpers/mockFileSystem';

const SOURCE = 'Thanh Dii_0.json';
const minute = 60_000;
const base = new Date(2025, 9, 11, 23, 16).getTime();

const RAW = JSON.stringify({
  threadName: 'Thanh Dii',
  participants: ['Quoc Duy', 'Thanh Dii'],
  messages: [
    { senderName: 'Thanh Dii', text: 'tin 4', timestamp: base + 40 * minute, type: 'text', isUnsent: false, media: [], reactions: [] },
    { senderName: 'Thanh Dii', text: 'tin 3', timestamp: base + 20 * minute + 30_000, type: 'text', isUnsent: false, media: [], reactions: [] },
    { senderName: 'Thanh Dii', text: 'tin 2', timestamp: base + 20 * minute, type: 'text', isUnsent: false, media: [], reactions: [] },
    { senderName: 'Quoc Duy', text: 'tin 1', timestamp: base + minute, type: 'text', isUnsent: false, media: [], reactions: [] },
    { senderName: 'Quoc Duy', text: 'tin 0', timestamp: base, type: 'text', isUnsent: false, media: [], reactions: [] },
  ],
});

// jsdom's Blob has no text(); browsers do.
if (typeof Blob.prototype.text !== 'function') {
  Object.defineProperty(Blob.prototype, 'text', {
    configurable: true,
    value(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function readText(directory: FileSystemDirectoryHandle, name: string): Promise<string> {
  return (await (await directory.getFileHandle(name)).getFile()).text();
}

async function listNames(directory: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name] of directory.entries()) names.push(name);
  return names.sort();
}

function setup(extraFiles: Record<string, string> = {}) {
  const directory = createMockDirectoryHandle('export', { [SOURCE]: RAW, media: { 'a.jpeg': 'jpeg bytes' }, ...extraFiles });
  const thread = parseMessengerExportJson(RAW);
  const entry = {
    folderName: 'Thanh Dii_0', title: 'Thanh Dii', participants: ['Quoc Duy', 'Thanh Dii'], messageCount: 5,
    folderSize: RAW.length, dirHandle: directory as unknown as ReadableDirectoryHandle, jsonFileCount: 1,
    source: 'inbox', _messengerExport: true, _jsonFileName: SOURCE,
  } as ChatListEntry;
  return { directory, thread, entry };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useOverlay', () => {
  it('loads an existing overlay and applies it by message id', async () => {
    const ids = getMessageIds(parseMessengerExportJson(RAW).messages);
    const withOverlay = setup({
      'Thanh Dii_0.overlay.json': JSON.stringify({
        version: 1, sourceFile: SOURCE, deleted: [ids[1]], favorites: [{ id: ids[3], addedAt: 5, note: 'x' }], updatedAt: 5,
      }),
    });
    const { result } = renderHook(() => useOverlay(withOverlay.entry, withOverlay.thread));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.persistence).toBe('file');
    expect([...result.current.deletedMask]).toEqual([0, 1, 0, 0, 0]);
    expect(result.current.favoritesByIndex.get(3)?.note).toBe('x');
  });

  it('autosaves after the debounce without changing the source JSON or media', async () => {
    const { directory, thread, entry } = setup();
    const before = sha256(await readText(directory, SOURCE));
    const { result } = renderHook(() => useOverlay(entry, thread));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.deleteMessages([0, 2]);
      result.current.toggleFavorite(4);
    });
    expect(result.current.deletedCount).toBe(2);
    expect(result.current.undo?.count).toBe(2);
    expect(await listNames(directory)).toEqual([SOURCE, 'media'].sort());

    await new Promise(resolve => setTimeout(resolve, OVERLAY_AUTOSAVE_MS + 100));
    await waitFor(async () => expect(await listNames(directory)).toContain('Thanh Dii_0.overlay.json'));
    const saved = JSON.parse(await readText(directory, 'Thanh Dii_0.overlay.json'));
    const ids = getMessageIds(thread.messages);
    expect(saved.version).toBe(1);
    expect(saved.sourceFile).toBe(SOURCE);
    expect(saved.deleted.sort()).toEqual([ids[0], ids[2]].sort());
    expect(saved.favorites).toEqual([expect.objectContaining({ id: ids[4], note: '' })]);

    act(() => result.current.undoDelete());
    expect(result.current.deletedCount).toBe(0);
    await new Promise(resolve => setTimeout(resolve, OVERLAY_AUTOSAVE_MS + 100));
    await waitFor(async () => expect(JSON.parse(await readText(directory, 'Thanh Dii_0.overlay.json')).deleted).toEqual([]));

    expect(sha256(await readText(directory, SOURCE))).toBe(before);
    const media = await directory.getDirectoryHandle('media');
    expect(await readText(media, 'a.jpeg')).toBe('jpeg bytes');
  }, 10_000);

  it('exports a cleaned copy beside the source and keeps the source', async () => {
    const { directory, thread, entry } = setup();
    const before = sha256(RAW);
    const { result } = renderHook(() => useOverlay(entry, thread));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // Display index 0 is the oldest message, source position 4.
    act(() => result.current.deleteMessages([0, 4]));
    let exported: Awaited<ReturnType<typeof result.current.exportCleaned>> | undefined;
    await act(async () => { exported = await result.current.exportCleaned(); });
    expect(exported).toEqual({ fileName: 'Thanh Dii_0.cleaned.json', removed: 2, mode: 'file' });
    const cleaned = JSON.parse(await readText(directory, 'Thanh Dii_0.cleaned.json'));
    expect(cleaned.messages.map((message: { text: string }) => message.text)).toEqual(['tin 3', 'tin 2', 'tin 1']);
    expect(cleaned.threadName).toBe('Thanh Dii');
    expect(sha256(await readText(directory, SOURCE))).toBe(before);
  });

  it('falls back to memory without write access or IndexedDB', async () => {
    const { thread, entry } = setup();
    const readOnly = {
      kind: 'directory', name: 'export',
      getFileHandle: entry.dirHandle.getFileHandle.bind(entry.dirHandle),
      getDirectoryHandle: entry.dirHandle.getDirectoryHandle.bind(entry.dirHandle),
      entries: entry.dirHandle.entries.bind(entry.dirHandle),
    } as ReadableDirectoryHandle;
    const { result } = renderHook(() => useOverlay({ ...entry, dirHandle: readOnly }, thread));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.persistence).toBe(typeof indexedDB === 'undefined' ? 'memory' : 'indexeddb');
  });

  it('is disabled for chats without a standalone Messenger file', () => {
    const { thread, entry } = setup();
    const { result } = renderHook(() => useOverlay({ ...entry, _messengerExport: false }, thread));
    expect(result.current.available).toBe(false);
  });
});

describe('message selection', () => {
  it('selects a range and skips hidden messages', () => {
    expect([...selectRange(new Set([1]), 2, 6, index => index !== 4)].sort()).toEqual([1, 2, 3, 5, 6]);
    expect([...selectRange(new Set(), 5, 3)].sort()).toEqual([3, 4, 5]);
  });

  it('toggles, extends with shift and resets for a new thread', () => {
    let key = 1;
    const { result, rerender } = renderHook(() => useMessageSelection(key));
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(5, true));
    expect([...result.current.selected].sort()).toEqual([2, 3, 4, 5]);
    act(() => result.current.toggle(3));
    expect(result.current.selected.has(3)).toBe(false);
    key = 2;
    rerender();
    expect(result.current.active).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });
});

describe('MessageList with an overlay', () => {
  beforeEach(() => {
    // jsdom has no layout; a zero-height chunk would be treated as empty.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, width: 300, height: 100, right: 300, bottom: 100, toJSON: () => ({}),
    } as DOMRect);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() => this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
      }
      unobserve() {}
      disconnect() {}
    });
  });

  const settings = { showMyName: false, showTheirName: true, showReactions: true, hideLikelyReactionNotices: false } as Settings;

  function Harness({ entry, thread }: { entry: ChatListEntry; thread: MessengerThread }) {
    const overlay = useOverlay(entry, thread);
    const selection = useMessageSelection(thread);
    return (
      <OverlayContext.Provider value={overlay}>
        <MessageSelectionContext.Provider value={selection}>
          <button type="button" onClick={() => overlay.deleteMessages([1])}>delete second</button>
          <MessageList
            chatData={thread}
            mediaState={createMediaState()}
            selectedPerspective="Quoc Duy"
            settings={settings}
            highlightQuery=""
            onScrollSync={() => {}}
          />
        </MessageSelectionContext.Provider>
      </OverlayContext.Provider>
    );
  }

  it('groups, separates, favorites and hides deleted messages', async () => {
    const { thread, entry } = setup();
    const { container } = render(<Harness entry={entry} thread={thread} />);
    await waitFor(() => expect(container.querySelectorAll('.message[data-msg-index]')).toHaveLength(5));

    // tin 0 and tin 1 are a minute apart: separate groups. tin 2 and tin 3 are 30 s apart: one group.
    const message = (index: number) => container.querySelector(`.message[data-msg-index="${index}"]`)!;
    expect(message(0).classList.contains('clump-last')).toBe(true);
    expect(message(1).classList.contains('clump-first')).toBe(true);
    expect(message(2).classList.contains('clump-last')).toBe(false);
    expect(message(3).classList.contains('clump-first')).toBe(false);
    // Avatar only on the last bubble of an incoming group.
    expect(message(2).querySelector('.message-avatar')).toBeNull();
    expect(message(3).querySelector('.message-avatar')?.textContent).toBe('TD');
    expect(message(0).querySelector('.message-avatar')).toBeNull();
    // Separators after gaps over 15 minutes: before tin 0, tin 2 (19 min) and tin 4 (19.5 min).
    expect([...container.querySelectorAll('.time-separator:not(.mobile-msg-timestamp)')].map(node => node.textContent))
      .toEqual([formatChatTimestamp(base), formatChatTimestamp(base + 20 * minute), formatChatTimestamp(base + 40 * minute)]);
    expect(formatChatTimestamp(base)).toBe('11:16 PM, 11 Thg 10, 2025');

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Favorite' })).toHaveLength(5));
    fireEvent.click(screen.getAllByRole('button', { name: 'Favorite' })[2]);
    await waitFor(() => expect(message(2).classList.contains('is-favorite')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'delete second' }));
    await waitFor(() => expect(container.querySelector('.message[data-msg-index="1"]')).toBeNull());
    expect(screen.queryByText('tin 1')).toBeNull();
    expect(screen.getByText('tin 0')).toBeTruthy();
  });
});
