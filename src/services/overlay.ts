import type { Overlay, OverlayFavorite } from '../types/overlay';
import type { ReadableDirectoryHandle, WritableDirectoryHandle } from '../types/fileSystem';

const DERIVED_FILE_PATTERN = /\.(overlay|cleaned)\.json$/i;
const WRITABLE_FILE_PATTERN = /\.(overlay|cleaned|favorites)\.json$/i;
export const FAVORITES_TITLE_SUFFIX = ' (Favorites)';

/** Overlay and cleaned files sit beside conversations but are not conversations. */
export function isOverlayArtifactFileName(name: string): boolean {
  return DERIVED_FILE_PATTERN.test(name);
}

/** Files this feature may create. Favorites files are conversations and stay listed. */
export function isWritableDerivedFileName(name: string): boolean {
  return WRITABLE_FILE_PATTERN.test(name);
}

export function getFavoritesFileName(jsonFileName: string): string {
  return jsonFileName.replace(/\.json$/i, '') + '.favorites.json';
}

export function getOverlayFileName(jsonFileName: string): string {
  return jsonFileName.replace(/\.json$/i, '') + '.overlay.json';
}

export function getCleanedFileName(jsonFileName: string): string {
  return jsonFileName.replace(/\.json$/i, '') + '.cleaned.json';
}

export function createEmptyOverlay(sourceFile: string): Overlay {
  return { version: 1, sourceFile, deleted: [], favorites: [], updatedAt: 0 };
}

export function isOverlayEmpty(overlay: Overlay): boolean {
  return overlay.deleted.length === 0 && overlay.favorites.length === 0 && !overlay.settings?.me;
}

function isFavorite(value: unknown): value is OverlayFavorite {
  return !!value && typeof value === 'object' && typeof (value as OverlayFavorite).id === 'string';
}

/** Returns null for anything that is not a version 1 overlay. */
export function parseOverlay(text: string, sourceFile: string): Overlay | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || (raw as Overlay).version !== 1) return null;
  const input = raw as Partial<Overlay>;
  const seenFavorites = new Set<string>();
  const favorites: OverlayFavorite[] = [];
  for (const item of Array.isArray(input.favorites) ? input.favorites : []) {
    if (!isFavorite(item) || seenFavorites.has(item.id)) continue;
    seenFavorites.add(item.id);
    favorites.push({
      id: item.id,
      addedAt: Number.isFinite(item.addedAt) ? Number(item.addedAt) : 0,
      note: typeof item.note === 'string' ? item.note : '',
    });
  }
  const me = input.settings && typeof input.settings === 'object' && typeof input.settings.me === 'string'
    ? input.settings.me : '';
  return {
    version: 1,
    sourceFile,
    deleted: [...new Set((Array.isArray(input.deleted) ? input.deleted : []).filter((id): id is string => typeof id === 'string'))],
    favorites,
    ...(me ? { settings: { me } } : {}),
    updatedAt: Number.isFinite(input.updatedAt) ? Number(input.updatedAt) : 0,
  };
}

export function serializeOverlay(overlay: Overlay): string {
  return JSON.stringify(overlay, null, 2) + '\n';
}

export interface AppliedOverlay {
  /** 1 where the message at that index is soft deleted. */
  deletedMask: Uint8Array;
  deletedCount: number;
  /** Favorites keyed by message index; ids without a message are omitted. */
  favoritesByIndex: Map<number, OverlayFavorite>;
}

export function getDeletedMask(messageIds: readonly string[], deleted: readonly string[]): Uint8Array {
  const mask = new Uint8Array(messageIds.length);
  if (deleted.length === 0) return mask;
  const ids = new Set(deleted);
  for (let index = 0; index < messageIds.length; index++) {
    if (ids.has(messageIds[index])) mask[index] = 1;
  }
  return mask;
}

export function getFavoritesByIndex(
  messageIds: readonly string[],
  favorites: readonly OverlayFavorite[]
): Map<number, OverlayFavorite> {
  const result = new Map<number, OverlayFavorite>();
  if (favorites.length === 0) return result;
  const byId = new Map(favorites.map(favorite => [favorite.id, favorite]));
  for (let index = 0; index < messageIds.length; index++) {
    const favorite = byId.get(messageIds[index]);
    if (favorite) result.set(index, favorite);
  }
  return result;
}

export function applyOverlay(messageIds: readonly string[], overlay: Overlay | null): AppliedOverlay {
  const deletedMask = getDeletedMask(messageIds, overlay?.deleted ?? []);
  let deletedCount = 0;
  for (let index = 0; index < deletedMask.length; index++) deletedCount += deletedMask[index];
  return { deletedMask, deletedCount, favoritesByIndex: getFavoritesByIndex(messageIds, overlay?.favorites ?? []) };
}

function touch(overlay: Overlay, changes: Partial<Overlay>, now: number): Overlay {
  return { ...overlay, ...changes, updatedAt: now };
}

export function setMessagesDeleted(overlay: Overlay, ids: readonly string[], deleted: boolean, now = Date.now()): Overlay {
  const next = new Set(overlay.deleted);
  const before = next.size;
  for (const id of ids) {
    if (deleted) next.add(id);
    else next.delete(id);
  }
  return next.size === before ? overlay : touch(overlay, { deleted: [...next] }, now);
}

export function toggleFavorite(overlay: Overlay, id: string, now = Date.now()): Overlay {
  const exists = overlay.favorites.some(favorite => favorite.id === id);
  return touch(overlay, {
    favorites: exists
      ? overlay.favorites.filter(favorite => favorite.id !== id)
      : [...overlay.favorites, { id, addedAt: now, note: '' }],
  }, now);
}

/** Add or remove several favorites at once; existing favorites keep their note and date. */
export function setMessagesFavorite(overlay: Overlay, ids: readonly string[], favorite: boolean, now = Date.now()): Overlay {
  const existing = new Set(overlay.favorites.map(item => item.id));
  if (favorite) {
    const additions = [...new Set(ids)].filter(id => !existing.has(id)).map(id => ({ id, addedAt: now, note: '' }));
    return additions.length === 0 ? overlay : touch(overlay, { favorites: [...overlay.favorites, ...additions] }, now);
  }
  const removed = new Set(ids);
  const favorites = overlay.favorites.filter(item => !removed.has(item.id));
  return favorites.length === overlay.favorites.length ? overlay : touch(overlay, { favorites }, now);
}

export function setFavoriteNote(overlay: Overlay, id: string, note: string, now = Date.now()): Overlay {
  const current = overlay.favorites.find(favorite => favorite.id === id);
  if (!current || current.note === note) return overlay;
  return touch(overlay, {
    favorites: overlay.favorites.map(favorite => favorite.id === id ? { ...favorite, note } : favorite),
  }, now);
}

export function setOverlayMe(overlay: Overlay, me: string, now = Date.now()): Overlay {
  if ((overlay.settings?.me || '') === me) return overlay;
  const settings = { ...overlay.settings };
  if (me) settings.me = me;
  else delete settings.me;
  const next = touch(overlay, {}, now);
  if (Object.keys(settings).length > 0) next.settings = settings;
  else delete next.settings;
  return next;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

/** Missing or unreadable overlay files load as "no overlay". */
export async function readOverlayFile(directory: ReadableDirectoryHandle, jsonFileName: string): Promise<Overlay | null> {
  try {
    const handle = await directory.getFileHandle(getOverlayFileName(jsonFileName));
    return parseOverlay(await (await handle.getFile()).text(), jsonFileName);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/**
 * The only write path of this feature. It refuses every name except
 * `*.overlay.json`, `*.cleaned.json` and `*.favorites.json`, so an exported
 * conversation file cannot be replaced even by a caller mistake.
 */
async function writeDerivedFile(directory: WritableDirectoryHandle, name: string, content: string): Promise<void> {
  if (!isWritableDerivedFileName(name)) throw new Error(`Refusing to write "${name}": not an overlay, cleaned or favorites file.`);
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export function writeOverlayFile(directory: WritableDirectoryHandle, overlay: Overlay): Promise<void> {
  return writeDerivedFile(directory, getOverlayFileName(overlay.sourceFile), serializeOverlay(overlay));
}

export function writeCleanedFile(directory: WritableDirectoryHandle, jsonFileName: string, content: string): Promise<void> {
  return writeDerivedFile(directory, getCleanedFileName(jsonFileName), content);
}

export function writeFavoritesFile(directory: WritableDirectoryHandle, jsonFileName: string, content: string): Promise<void> {
  return writeDerivedFile(directory, getFavoritesFileName(jsonFileName), content);
}

/**
 * A conversation in the source's own format holding only the favorite
 * messages, in source order. Media paths stay valid because the file sits
 * beside the source. Notes are kept in `favoriteNotes`, indexed by position
 * in the new `messages` array; the viewer ignores the extra field.
 */
export function buildFavoritesJson(rawContent: string, favoritesBySourceIndex: ReadonlyMap<number, OverlayFavorite>): { content: string; count: number } {
  const raw = JSON.parse(rawContent) as { messages?: unknown[]; threadName?: unknown };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) {
    throw new Error('The conversation file has no message list.');
  }
  const messages: unknown[] = [];
  const favoriteNotes: { index: number; addedAt: number; note: string }[] = [];
  raw.messages.forEach((message, sourceIndex) => {
    const favorite = favoritesBySourceIndex.get(sourceIndex);
    if (!favorite) return;
    if (favorite.note) favoriteNotes.push({ index: messages.length, addedAt: favorite.addedAt, note: favorite.note });
    messages.push(message);
  });
  const title = typeof raw.threadName === 'string' ? raw.threadName : 'conversation';
  return {
    content: JSON.stringify({
      ...raw,
      threadName: title.endsWith(FAVORITES_TITLE_SUFFIX) ? title : title + FAVORITES_TITLE_SUFFIX,
      messages,
      ...(favoriteNotes.length > 0 ? { favoriteNotes } : {}),
    }, null, 2) + '\n',
    count: messages.length,
  };
}

/**
 * Copies a raw conversation without the messages at `deletedSourceIndices`
 * (positions in the raw `messages` array). Everything else is preserved.
 */
export function buildCleanedJson(rawContent: string, deletedSourceIndices: ReadonlySet<number>): string {
  const raw = JSON.parse(rawContent) as { messages?: unknown[] };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) {
    throw new Error('The conversation file has no message list.');
  }
  return JSON.stringify({
    ...raw,
    messages: raw.messages.filter((_message, index) => !deletedSourceIndices.has(index)),
  }, null, 2) + '\n';
}

export async function hasWritePermission(directory: ReadableDirectoryHandle): Promise<boolean> {
  const handle = directory as ReadableDirectoryHandle & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (typeof handle.queryPermission !== 'function') return false;
  try {
    return await handle.queryPermission({ mode: 'readwrite' }) === 'granted';
  } catch {
    return false;
  }
}
