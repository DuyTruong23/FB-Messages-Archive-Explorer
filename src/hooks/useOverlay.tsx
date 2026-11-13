import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatListEntry, MessengerThread } from '../types/messenger';
import type { ReadableDirectoryHandle, WritableDirectoryHandle } from '../types/fileSystem';
import type { Overlay, OverlayFavorite, OverlayPersistence } from '../types/overlay';
import { getMessageIds } from '../services/messageId';
import {
  buildCleanedJson, buildFavoritesJson, createEmptyOverlay, getCleanedFileName, getDeletedMask,
  getFavoritesByIndex, getFavoritesFileName, getOverlayFileName, hasWritePermission, readOverlayFile,
  serializeOverlay, setFavoriteNote, setMessagesDeleted, setMessagesFavorite, setOverlayMe,
  toggleFavorite, writeCleanedFile, writeFavoritesFile, writeOverlayFile,
} from '../services/overlay';
import { getOverlayStoreKey, isOverlayStoreAvailable, loadStoredOverlay, saveStoredOverlay } from '../services/overlayStore';

export const OVERLAY_AUTOSAVE_MS = 1000;
const UNDO_VISIBLE_MS = 8000;
const EMPTY_MASK = new Uint8Array(0);
const EMPTY_FAVORITES = new Map<number, OverlayFavorite>();
const EMPTY_IDS: string[] = [];

interface OverlayTarget {
  directory: ReadableDirectoryHandle;
  sourceFile: string;
  thread: MessengerThread;
}

export interface OverlayUndo {
  ids: string[];
  count: number;
}

export interface FavoritesExportResult {
  fileName: string;
  count: number;
  mode: 'file' | 'download';
}

export interface CleanedExportResult {
  fileName: string;
  removed: number;
  /** "file" was written beside the source; "download" went to the browser's downloads. */
  mode: 'file' | 'download';
}

export interface OverlayController {
  /** Message edits exist only for standalone Messenger conversations. */
  available: boolean;
  loaded: boolean;
  overlay: Overlay | null;
  persistence: OverlayPersistence;
  saving: boolean;
  error: string | null;
  messageIds: readonly string[];
  /** 1 where the message at that index is soft deleted. */
  deletedMask: Uint8Array;
  deletedCount: number;
  favoritesByIndex: ReadonlyMap<number, OverlayFavorite>;
  favoriteIndices: ReadonlySet<number>;
  undo: OverlayUndo | null;
  deleteMessages: (indices: readonly number[]) => void;
  restoreMessages: (ids: readonly string[]) => void;
  undoDelete: () => void;
  dismissUndo: () => void;
  toggleFavorite: (index: number) => void;
  /** Favorite or unfavorite several messages, e.g. the current selection. */
  setFavorites: (indices: readonly number[], favorite: boolean) => void;
  /** Write `<thread>.favorites.json`: a conversation of the favorite messages, openable like the source. */
  exportFavorites: () => Promise<FavoritesExportResult>;
  setFavoriteNote: (id: string, note: string) => void;
  setMe: (name: string) => void;
  exportCleaned: () => Promise<CleanedExportResult>;
  exportOverlay: () => void;
  /** Re-check write access after the user grants or revokes it. */
  refreshPersistence: () => Promise<void>;
  clearError: () => void;
}

const noop = () => {};
const DISABLED: OverlayController = {
  available: false, loaded: false, overlay: null, persistence: 'memory', saving: false, error: null,
  messageIds: EMPTY_IDS, deletedMask: EMPTY_MASK, deletedCount: 0,
  favoritesByIndex: EMPTY_FAVORITES, favoriteIndices: new Set<number>(), undo: null,
  deleteMessages: noop, restoreMessages: noop, undoDelete: noop, dismissUndo: noop,
  toggleFavorite: noop, setFavorites: noop, setFavoriteNote: noop, setMe: noop,
  exportFavorites: () => Promise.reject(new Error('No conversation is open.')),
  exportCleaned: () => Promise.reject(new Error('No conversation is open.')),
  exportOverlay: noop, refreshPersistence: () => Promise.resolve(), clearError: noop,
};

export const OverlayContext = createContext<OverlayController>(DISABLED);

export function useOverlayContext(): OverlayController {
  return useContext(OverlayContext);
}

function downloadText(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function resolvePersistence(directory: ReadableDirectoryHandle): Promise<OverlayPersistence> {
  if (await hasWritePermission(directory)) return 'file';
  return isOverlayStoreAvailable() ? 'indexeddb' : 'memory';
}

/** Writes go to the overlay file when the folder is writable, otherwise to IndexedDB. */
async function persistOverlay(target: OverlayTarget, overlay: Overlay): Promise<OverlayPersistence> {
  const persistence = await resolvePersistence(target.directory);
  if (persistence === 'file') {
    await writeOverlayFile(target.directory as WritableDirectoryHandle, overlay);
    return 'file';
  }
  if (persistence === 'indexeddb'
    && await saveStoredOverlay(getOverlayStoreKey(target.directory.name, target.sourceFile), overlay)) {
    return 'indexeddb';
  }
  return 'memory';
}

export function useOverlay(entry: ChatListEntry | null, chatData: MessengerThread | null): OverlayController {
  // Chat list entries are recreated when sizes update; key on the stable parts.
  const directory = entry?._messengerExport ? entry.dirHandle : null;
  const sourceFile = entry?._messengerExport ? entry._jsonFileName : undefined;
  const target = useMemo<OverlayTarget | null>(() => (
    directory && sourceFile && chatData ? { directory, sourceFile, thread: chatData } : null
  ), [directory, sourceFile, chatData]);

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [persistence, setPersistence] = useState<OverlayPersistence>('memory');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<OverlayUndo | null>(null);

  const overlayRef = useRef<Overlay | null>(null);
  const targetRef = useRef<OverlayTarget | null>(null);
  const generationRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(0);

  const save = useCallback((saveTarget: OverlayTarget, next: Overlay) => {
    pendingWritesRef.current++;
    setSaving(true);
    writeQueueRef.current = writeQueueRef.current
      .catch(() => {})
      .then(() => persistOverlay(saveTarget, next))
      .then(result => {
        if (targetRef.current !== saveTarget) return;
        setPersistence(result);
        setError(result === 'memory' ? 'Không lưu được thay đổi. Hãy dùng "Export overlay" để giữ lại.' : null);
      })
      .catch(saveError => {
        console.error('Failed to save overlay:', saveError);
        if (targetRef.current === saveTarget) setError('Không ghi được file overlay. Kiểm tra quyền ghi thư mục.');
      })
      .finally(() => {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        setSaving(pendingWritesRef.current > 0);
      });
  }, []);

  const flush = useCallback(() => {
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (targetRef.current && overlayRef.current) save(targetRef.current, overlayRef.current);
  }, [save]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flush, OVERLAY_AUTOSAVE_MS);
  }, [flush]);

  useEffect(() => {
    const generation = ++generationRef.current;
    targetRef.current = target;
    overlayRef.current = target ? createEmptyOverlay(target.sourceFile) : null;
    setOverlay(overlayRef.current);
    setLoaded(false);
    setError(null);
    setUndo(null);
    setPersistence('memory');
    if (!target) return;

    void (async () => {
      let fromFile: Overlay | null = null;
      try {
        fromFile = await readOverlayFile(target.directory, target.sourceFile);
      } catch (loadError) {
        console.error('Failed to read overlay file:', loadError);
      }
      const stored = await loadStoredOverlay(getOverlayStoreKey(target.directory.name, target.sourceFile), target.sourceFile);
      const resolved = await resolvePersistence(target.directory);
      if (generationRef.current !== generation) return;
      // Edits made while the folder was read-only live in IndexedDB and may be newer.
      const storedIsNewer = !!stored && (!fromFile || stored.updatedAt > fromFile.updatedAt);
      const initial = (storedIsNewer ? stored : fromFile) ?? createEmptyOverlay(target.sourceFile);
      overlayRef.current = initial;
      setOverlay(initial);
      setPersistence(resolved);
      setLoaded(true);
      // Move those edits beside the conversation once the folder is writable.
      if (storedIsNewer && resolved === 'file') save(target, initial);
    })();

    return () => {
      // Do not lose the last edits when the chat changes within the debounce window.
      flush();
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, [target, flush, save]);

  useEffect(() => {
    const onPageHide = () => flush();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [flush]);

  const update = useCallback((change: (current: Overlay) => Overlay): boolean => {
    const current = overlayRef.current;
    if (!current || !targetRef.current) return false;
    const next = change(current);
    if (next === current) return false;
    overlayRef.current = next;
    setOverlay(next);
    scheduleSave();
    return true;
  }, [scheduleSave]);

  const messageIds = useMemo(() => target ? getMessageIds(target.thread.messages) : EMPTY_IDS, [target]);
  const deleted = overlay?.deleted;
  const favorites = overlay?.favorites;
  const deletedMask = useMemo(
    () => deleted && deleted.length > 0 ? getDeletedMask(messageIds, deleted) : EMPTY_MASK,
    [messageIds, deleted]
  );
  const deletedCount = useMemo(() => deletedMask.reduce((sum, value) => sum + value, 0), [deletedMask]);
  const favoritesByIndex = useMemo(
    () => favorites && favorites.length > 0 ? getFavoritesByIndex(messageIds, favorites) : EMPTY_FAVORITES,
    [messageIds, favorites]
  );
  const favoriteIndices = useMemo(() => new Set(favoritesByIndex.keys()), [favoritesByIndex]);

  const dismissUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndo(null);
  }, []);

  const deleteMessages = useCallback((indices: readonly number[]) => {
    const ids = indices.map(index => messageIds[index]).filter((id): id is string => !!id);
    if (ids.length === 0 || !update(current => setMessagesDeleted(current, ids, true))) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo({ ids, count: ids.length });
    undoTimerRef.current = setTimeout(() => setUndo(null), UNDO_VISIBLE_MS);
  }, [messageIds, update]);

  const restoreMessages = useCallback((ids: readonly string[]) => {
    update(current => setMessagesDeleted(current, ids, false));
  }, [update]);

  const undoDelete = useCallback(() => {
    if (undo) restoreMessages(undo.ids);
    dismissUndo();
  }, [undo, restoreMessages, dismissUndo]);

  const toggleFavoriteAt = useCallback((index: number) => {
    const id = messageIds[index];
    if (id) update(current => toggleFavorite(current, id));
  }, [messageIds, update]);

  const setNote = useCallback((id: string, note: string) => {
    update(current => setFavoriteNote(current, id, note));
  }, [update]);

  const setMe = useCallback((name: string) => {
    update(current => setOverlayMe(current, name));
  }, [update]);

  const exportCleaned = useCallback(async (): Promise<CleanedExportResult> => {
    const exportTarget = targetRef.current;
    if (!exportTarget) throw new Error('No conversation is open.');
    const removedSourceIndices = new Set<number>();
    exportTarget.thread.messages.forEach((message, index) => {
      if (deletedMask[index]) removedSourceIndices.add(message._sourceIndex ?? index);
    });
    // Read the source again so the copy keeps every field the viewer does not model.
    const sourceHandle = await exportTarget.directory.getFileHandle(exportTarget.sourceFile);
    const content = buildCleanedJson(await (await sourceHandle.getFile()).text(), removedSourceIndices);
    const fileName = getCleanedFileName(exportTarget.sourceFile);
    if (await hasWritePermission(exportTarget.directory)) {
      await writeCleanedFile(exportTarget.directory as WritableDirectoryHandle, exportTarget.sourceFile, content);
      return { fileName, removed: removedSourceIndices.size, mode: 'file' };
    }
    downloadText(fileName, content);
    return { fileName, removed: removedSourceIndices.size, mode: 'download' };
  }, [deletedMask]);

  const setFavorites = useCallback((indices: readonly number[], favorite: boolean) => {
    const ids = indices.map(index => messageIds[index]).filter((id): id is string => !!id);
    if (ids.length > 0) update(current => setMessagesFavorite(current, ids, favorite));
  }, [messageIds, update]);

  const exportFavorites = useCallback(async (): Promise<FavoritesExportResult> => {
    const exportTarget = targetRef.current;
    if (!exportTarget) throw new Error('No conversation is open.');
    // Hidden messages stay out, matching what the chat shows.
    const bySourceIndex = new Map<number, OverlayFavorite>();
    favoritesByIndex.forEach((favorite, index) => {
      if (deletedMask[index]) return;
      const message = exportTarget.thread.messages[index];
      if (message) bySourceIndex.set(message._sourceIndex ?? index, favorite);
    });
    const sourceHandle = await exportTarget.directory.getFileHandle(exportTarget.sourceFile);
    const { content, count } = buildFavoritesJson(await (await sourceHandle.getFile()).text(), bySourceIndex);
    const fileName = getFavoritesFileName(exportTarget.sourceFile);
    if (await hasWritePermission(exportTarget.directory)) {
      const directory = exportTarget.directory as WritableDirectoryHandle;
      await writeFavoritesFile(directory, exportTarget.sourceFile, content);
      // Open the favorites chat from the same side ("me") as the source.
      const me = overlayRef.current?.settings?.me;
      if (me && !await readOverlayFile(directory, fileName).catch(() => null)) {
        await writeOverlayFile(directory, setOverlayMe(createEmptyOverlay(fileName), me)).catch(() => {});
      }
      return { fileName, count, mode: 'file' };
    }
    downloadText(fileName, content);
    return { fileName, count, mode: 'download' };
  }, [favoritesByIndex, deletedMask]);

  const exportOverlay = useCallback(() => {
    if (overlayRef.current) downloadText(getOverlayFileName(overlayRef.current.sourceFile), serializeOverlay(overlayRef.current));
  }, []);

  const refreshPersistence = useCallback(async () => {
    const current = targetRef.current;
    if (!current) return;
    const resolved = await resolvePersistence(current.directory);
    if (targetRef.current !== current) return;
    setPersistence(resolved);
    if (resolved === 'file' && overlayRef.current) save(current, overlayRef.current);
  }, [save]);

  const clearError = useCallback(() => setError(null), []);

  return useMemo<OverlayController>(() => target ? {
    available: true, loaded, overlay, persistence, saving, error,
    messageIds, deletedMask, deletedCount, favoritesByIndex, favoriteIndices, undo,
    deleteMessages, restoreMessages, undoDelete, dismissUndo,
    toggleFavorite: toggleFavoriteAt, setFavorites, setFavoriteNote: setNote, setMe,
    exportFavorites, exportCleaned, exportOverlay, refreshPersistence, clearError,
  } : DISABLED, [
    target, loaded, overlay, persistence, saving, error, messageIds, deletedMask, deletedCount,
    favoritesByIndex, favoriteIndices, undo, deleteMessages, restoreMessages, undoDelete, dismissUndo,
    toggleFavoriteAt, setFavorites, setNote, setMe, exportFavorites, exportCleaned, exportOverlay,
    refreshPersistence, clearError,
  ]);
}
