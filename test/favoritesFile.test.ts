import { describe, expect, it } from 'vitest';
import {
  buildFavoritesJson, createEmptyOverlay, getFavoritesFileName, isOverlayArtifactFileName,
  isWritableDerivedFileName, setMessagesFavorite, toggleFavorite, writeFavoritesFile,
} from '../src/services/overlay';
import { listMessengerExportChats, loadMessengerExportEntry } from '../src/services/messengerExport';
import { parseMessengerExportJson } from '../src/services/messengerExport/messengerExportParser';
import type { ReadableDirectoryHandle, WritableDirectoryHandle } from '../src/types/fileSystem';
import { createMockDirectoryHandle } from './helpers/mockFileSystem';

const SOURCE = 'Thanh Dii_0.json';
const raw = {
  participants: ['Quoc Duy', 'Thanh Dii'],
  threadName: 'Thanh Dii',
  magic: { keep: true },
  messages: [
    { senderName: 'Quoc Duy', text: 'newest', timestamp: 300, type: 'text', media: [], reactions: [{ actor: 'Thanh Dii', reaction: '❤' }] },
    { senderName: 'Thanh Dii', text: '', timestamp: 200, type: 'media', media: [{ uri: './media/a.jpeg' }], reactions: [] },
    { senderName: 'Quoc Duy', text: 'oldest', timestamp: 100, type: 'text', media: [], reactions: [] },
  ],
};

describe('bulk favorites', () => {
  it('adds missing favorites and keeps existing notes', () => {
    const start = { ...toggleFavorite(createEmptyOverlay(SOURCE), 'a', 1), favorites: [{ id: 'a', addedAt: 1, note: 'keep' }] };
    const added = setMessagesFavorite(start, ['a', 'b', 'c', 'b'], true, 5);
    expect(added.favorites).toEqual([
      { id: 'a', addedAt: 1, note: 'keep' },
      { id: 'b', addedAt: 5, note: '' },
      { id: 'c', addedAt: 5, note: '' },
    ]);
    expect(setMessagesFavorite(added, ['a', 'b'], true, 9)).toBe(added);
    expect(setMessagesFavorite(added, ['a', 'c'], false, 9).favorites.map(item => item.id)).toEqual(['b']);
    expect(setMessagesFavorite(added, ['missing'], false, 9)).toBe(added);
  });
});

describe('favorites file', () => {
  it('is a conversation in the source format with only favorite messages', () => {
    const { content, count } = buildFavoritesJson(JSON.stringify(raw), new Map([
      [0, { id: 'x', addedAt: 7, note: 'đẹp' }],
      [1, { id: 'y', addedAt: 8, note: '' }],
    ]));
    const file = JSON.parse(content);
    expect(count).toBe(2);
    expect(file).toEqual({
      ...raw,
      threadName: 'Thanh Dii (Favorites)',
      messages: [raw.messages[0], raw.messages[1]],
      favoriteNotes: [{ index: 0, addedAt: 7, note: 'đẹp' }],
    });
  });

  it('opens like the source: same participants, media paths and reactions', () => {
    const { content } = buildFavoritesJson(JSON.stringify(raw), new Map([[0, { id: 'x', addedAt: 1, note: '' }], [1, { id: 'y', addedAt: 1, note: '' }]]));
    const favorites = parseMessengerExportJson(content);
    const source = parseMessengerExportJson(JSON.stringify(raw));
    expect(favorites.title).toBe('Thanh Dii (Favorites)');
    expect(favorites.participants).toEqual(source.participants);
    expect(favorites.messages.map(({ _sourceIndex: _ignored, ...message }) => message))
      .toEqual(source.messages.slice(1).map(({ _sourceIndex: _ignored, ...message }) => message));
  });

  it('does not repeat the title suffix for a favorites file of a favorites file', () => {
    const { content } = buildFavoritesJson(JSON.stringify({ ...raw, threadName: 'Thanh Dii (Favorites)' }), new Map());
    expect(JSON.parse(content).threadName).toBe('Thanh Dii (Favorites)');
  });

  it('is writable, listed as a chat, and never replaces the source', async () => {
    expect(getFavoritesFileName(SOURCE)).toBe('Thanh Dii_0.favorites.json');
    expect(isWritableDerivedFileName('Thanh Dii_0.favorites.json')).toBe(true);
    expect(isWritableDerivedFileName(SOURCE)).toBe(false);
    expect(isOverlayArtifactFileName('Thanh Dii_0.favorites.json')).toBe(false);

    const original = JSON.stringify(raw);
    const directory = createMockDirectoryHandle('export', { [SOURCE]: original });
    const { content } = buildFavoritesJson(original, new Map([[2, { id: 'z', addedAt: 1, note: '' }]]));
    await writeFavoritesFile(directory as unknown as WritableDirectoryHandle, SOURCE, content);
    await directory.getFileHandle('Thanh Dii_0.overlay.json', { create: true });

    const chats = await listMessengerExportChats(directory as unknown as ReadableDirectoryHandle);
    expect(chats.map(chat => [chat._jsonFileName, chat.title, chat.messageCount]).sort()).toEqual([
      ['Thanh Dii_0.favorites.json', 'Thanh Dii (Favorites)', 1],
      [SOURCE, 'Thanh Dii', 3],
    ]);
    const entry = await loadMessengerExportEntry(directory as unknown as ReadableDirectoryHandle, 'Thanh Dii_0.favorites.json');
    expect(entry).toMatchObject({ title: 'Thanh Dii (Favorites)', messageCount: 1, _messengerExport: true, lastMessage: 'oldest' });
    expect(await (await (await directory.getFileHandle(SOURCE)).getFile()).text()).toBe(original);
  });
});
