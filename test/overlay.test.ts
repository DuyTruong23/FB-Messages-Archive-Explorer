import { describe, expect, it } from 'vitest';
import {
  applyOverlay, buildCleanedJson, createEmptyOverlay, getCleanedFileName, getOverlayFileName,
  isOverlayArtifactFileName, parseOverlay, readOverlayFile, serializeOverlay, setFavoriteNote,
  setMessagesDeleted, setOverlayMe, toggleFavorite, writeCleanedFile, writeOverlayFile,
} from '../src/services/overlay';
import type { WritableDirectoryHandle } from '../src/types/fileSystem';
import { createMockDirectoryHandle } from './helpers/mockFileSystem';

const SOURCE = 'Thanh Dii_0.json';

async function readText(directory: FileSystemDirectoryHandle, name: string): Promise<string> {
  return (await (await directory.getFileHandle(name)).getFile()).text();
}

describe('overlay file names', () => {
  it('derives names beside the source file', () => {
    expect(getOverlayFileName(SOURCE)).toBe('Thanh Dii_0.overlay.json');
    expect(getCleanedFileName(SOURCE)).toBe('Thanh Dii_0.cleaned.json');
  });

  it('recognizes only derived files', () => {
    expect(isOverlayArtifactFileName('Thanh Dii_0.overlay.json')).toBe(true);
    expect(isOverlayArtifactFileName('Thanh Dii_0.CLEANED.JSON')).toBe(true);
    expect(isOverlayArtifactFileName(SOURCE)).toBe(false);
    expect(isOverlayArtifactFileName('overlay.json')).toBe(false);
  });
});

describe('parseOverlay', () => {
  it('round-trips a serialized overlay', () => {
    let overlay = createEmptyOverlay(SOURCE);
    overlay = setMessagesDeleted(overlay, ['a', 'b'], true, 10);
    overlay = toggleFavorite(overlay, 'c', 20);
    overlay = setFavoriteNote(overlay, 'c', 'ghi chú', 30);
    overlay = setOverlayMe(overlay, 'Quoc Duy', 40);
    expect(parseOverlay(serializeOverlay(overlay), SOURCE)).toEqual({
      version: 1, sourceFile: SOURCE, deleted: ['a', 'b'],
      favorites: [{ id: 'c', addedAt: 20, note: 'ghi chú' }],
      settings: { me: 'Quoc Duy' }, updatedAt: 40,
    });
  });

  it('rejects invalid JSON and unknown versions', () => {
    expect(parseOverlay('{', SOURCE)).toBeNull();
    expect(parseOverlay('{"version":2,"deleted":[]}', SOURCE)).toBeNull();
    expect(parseOverlay('[]', SOURCE)).toBeNull();
  });

  it('drops malformed entries and duplicates', () => {
    const overlay = parseOverlay(JSON.stringify({
      version: 1, deleted: ['a', 5, 'a', null],
      favorites: [{ id: 'x' }, { note: 'no id' }, { id: 'x', note: 'dup' }],
    }), SOURCE);
    expect(overlay?.deleted).toEqual(['a']);
    expect(overlay?.favorites).toEqual([{ id: 'x', addedAt: 0, note: '' }]);
  });
});

describe('overlay mutations', () => {
  it('deletes and restores without mutating the input', () => {
    const empty = createEmptyOverlay(SOURCE);
    const deleted = setMessagesDeleted(empty, ['a', 'b', 'a'], true, 5);
    expect(empty.deleted).toEqual([]);
    expect(deleted.deleted).toEqual(['a', 'b']);
    expect(deleted.updatedAt).toBe(5);
    expect(setMessagesDeleted(deleted, ['a'], true, 9)).toBe(deleted);
    expect(setMessagesDeleted(deleted, ['a'], false, 9).deleted).toEqual(['b']);
  });

  it('toggles favorites and edits notes', () => {
    const added = toggleFavorite(createEmptyOverlay(SOURCE), 'a', 7);
    expect(added.favorites).toEqual([{ id: 'a', addedAt: 7, note: '' }]);
    expect(setFavoriteNote(added, 'a', 'note', 8).favorites[0].note).toBe('note');
    expect(setFavoriteNote(added, 'missing', 'note', 8)).toBe(added);
    expect(toggleFavorite(added, 'a', 9).favorites).toEqual([]);
  });

  it('sets and clears "me"', () => {
    const withMe = setOverlayMe(createEmptyOverlay(SOURCE), 'Quoc Duy', 1);
    expect(withMe.settings).toEqual({ me: 'Quoc Duy' });
    expect(setOverlayMe(withMe, 'Quoc Duy', 2)).toBe(withMe);
    expect(setOverlayMe(withMe, '', 3).settings).toBeUndefined();
  });
});

describe('applyOverlay', () => {
  const ids = ['m0', 'm1', 'm2', 'm3'];

  it('returns an empty mask without an overlay', () => {
    const applied = applyOverlay(ids, null);
    expect([...applied.deletedMask]).toEqual([0, 0, 0, 0]);
    expect(applied.deletedCount).toBe(0);
    expect(applied.favoritesByIndex.size).toBe(0);
  });

  it('hides deleted messages and marks favorites by index', () => {
    const overlay = {
      ...createEmptyOverlay(SOURCE),
      deleted: ['m1', 'm3', 'unknown'],
      favorites: [{ id: 'm2', addedAt: 1, note: 'n' }, { id: 'gone', addedAt: 2, note: '' }],
    };
    const applied = applyOverlay(ids, overlay);
    expect([...applied.deletedMask]).toEqual([0, 1, 0, 1]);
    expect(applied.deletedCount).toBe(2);
    expect([...applied.favoritesByIndex]).toEqual([[2, { id: 'm2', addedAt: 1, note: 'n' }]]);
  });
});

describe('buildCleanedJson', () => {
  it('removes only the deleted source positions and keeps other fields', () => {
    const raw = {
      participants: ['Quoc Duy', 'Thanh Dii'], threadName: 'Thanh Dii', extra: { keep: true },
      messages: [
        { senderName: 'A', text: 'zero', timestamp: 3 },
        { senderName: 'B', text: 'một', timestamp: 2, media: [{ uri: './media/x.jpeg' }] },
        { senderName: 'A', text: 'two', timestamp: 1 },
      ],
    };
    const cleaned = JSON.parse(buildCleanedJson(JSON.stringify(raw), new Set([0, 2])));
    expect(cleaned).toEqual({ ...raw, messages: [raw.messages[1]] });
  });

  it('rejects content without a message list', () => {
    expect(() => buildCleanedJson('{"threadName":"x"}', new Set())).toThrow();
  });
});

describe('overlay files', () => {
  it('writes overlay and cleaned files without touching the source or media', async () => {
    const original = '{"threadName":"Thanh Dii","participants":["A"],"messages":[]}';
    const directory = createMockDirectoryHandle('export', { [SOURCE]: original, media: { 'a.jpeg': 'bytes' } });
    const writable = directory as unknown as WritableDirectoryHandle;

    expect(await readOverlayFile(writable, SOURCE)).toBeNull();
    const overlay = setMessagesDeleted(createEmptyOverlay(SOURCE), ['a'], true, 1);
    await writeOverlayFile(writable, overlay);
    await writeCleanedFile(writable, SOURCE, 'cleaned');

    expect(await readOverlayFile(writable, SOURCE)).toEqual(overlay);
    expect(await readText(directory, 'Thanh Dii_0.cleaned.json')).toBe('cleaned');
    expect(await readText(directory, SOURCE)).toBe(original);
    const media = await directory.getDirectoryHandle('media');
    expect(await readText(media, 'a.jpeg')).toBe('bytes');
  });

  it('never maps a derived name onto the conversation file', async () => {
    const directory = createMockDirectoryHandle('export', { [SOURCE]: 'original' });
    const writable = directory as unknown as WritableDirectoryHandle;
    // Unusual source names still gain the suffix instead of replacing a file.
    await writeOverlayFile(writable, createEmptyOverlay('Thanh Dii_0'));
    await writeCleanedFile(writable, 'Thanh Dii_0.JSON', 'cleaned');
    const names: string[] = [];
    for await (const [name] of directory.entries()) names.push(name);
    expect(names.sort()).toEqual(['Thanh Dii_0.cleaned.json', 'Thanh Dii_0.overlay.json', SOURCE].sort());
    expect(await readText(directory, SOURCE)).toBe('original');
  });

  it('treats an unreadable overlay as absent', async () => {
    const directory = createMockDirectoryHandle('export', { 'Thanh Dii_0.overlay.json': 'not json' });
    expect(await readOverlayFile(directory as unknown as WritableDirectoryHandle, SOURCE)).toBeNull();
  });
});
