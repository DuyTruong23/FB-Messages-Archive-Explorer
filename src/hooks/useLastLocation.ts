import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatListEntry, MessengerThread } from '../types/messenger';
import type { MobileNavigationController } from '../services/mobileNavigation';
import { getBookmarkChatId } from '../services/bookmarks';
import { parseSavedLocation, toSavedLocation, type SavedLocation } from '../services/lastLocation';
import type { SavedFolder } from '../platform/android/savedFolder';

declare global {
  interface Window {
    /** Called by the Android shell in onPause. */
    fbmaeSaveState?: () => void;
  }
}

/** waiting → (folder reopened) loading → pending → (location published) applying → done. */
type Phase = 'waiting' | 'loading' | 'pending' | 'applying' | 'done';

const NAVIGATION_SAVE_DELAY_MS = 300;
const SCROLL_SAVE_DELAY_MS = 700;
/** Lets the chat finish restoring its scroll position before saves resume. */
const RESTORE_SETTLE_MS = 1000;
const RESTORE_GIVE_UP_MS = 15_000;

interface LastLocationOptions {
  navigation: MobileNavigationController;
  savedFolder: SavedFolder | null;
  /** getFolderKey() of the open folder, or null when none is open. */
  folderKey: string | null;
  archiveList: readonly ChatListEntry[];
  archiveLoading: boolean;
  activeEntry: ChatListEntry | null;
  chatLoading: boolean;
  chatData: MessengerThread | null;
}

/** Saves where the user is and returns there after the saved folder reopens on the next launch. */
export function useLastLocation({
  navigation, savedFolder, folderKey, archiveList, archiveLoading, activeEntry, chatLoading, chatData,
}: LastLocationOptions) {
  const [phase, setPhase] = useState<Phase>(savedFolder ? 'waiting' : 'done');
  const pendingRef = useRef<SavedLocation | null>(null);

  const beginRestore = useCallback((folder: string | null) => {
    if (!savedFolder || !folder) { setPhase('done'); return; }
    setPhase('loading');
    void savedFolder.loadLocation().then(text => {
      pendingRef.current = parseSavedLocation(text, folder);
      setPhase(pendingRef.current ? 'pending' : 'done');
    });
  }, [savedFolder]);

  const skipRestore = useCallback(() => {
    setPhase(current => current === 'waiting' ? 'done' : current);
  }, []);

  useEffect(() => {
    if (phase !== 'pending' || archiveLoading) return;
    const saved = pendingRef.current;
    const chatId = saved?.location.chatId;
    if (!saved || (chatId && !archiveList.some(entry => getBookmarkChatId(entry) === chatId))) {
      setPhase('done');
      return;
    }
    navigation.restore(saved.location, saved.snapshot);
    setPhase(chatId ? 'applying' : 'done');
  }, [phase, archiveLoading, archiveList, navigation]);

  useEffect(() => {
    if (phase !== 'applying') return;
    const giveUp = setTimeout(() => setPhase('done'), RESTORE_GIVE_UP_MS);
    const chatId = pendingRef.current?.location.chatId;
    const loaded = !!activeEntry && getBookmarkChatId(activeEntry) === chatId && !chatLoading && !!chatData;
    const settle = loaded || navigation.getState().location.chatId !== chatId
      ? setTimeout(() => setPhase('done'), RESTORE_SETTLE_MS) : undefined;
    return () => {
      clearTimeout(giveUp);
      if (settle) clearTimeout(settle);
    };
  }, [phase, activeEntry, chatLoading, chatData, navigation]);

  const ready = phase === 'done' && !!savedFolder && !!folderKey && !archiveLoading;
  const readyRef = useRef(false);
  const folderRef = useRef(folderKey);
  readyRef.current = ready;
  folderRef.current = folderKey;
  const lastSavedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const folder = folderRef.current;
    if (!readyRef.current || !savedFolder || !folder) return;
    const { location } = navigation.getState();
    const text = JSON.stringify(toSavedLocation(folder, location, navigation.capture()));
    if (text === lastSavedRef.current) return;
    lastSavedRef.current = text;
    void savedFolder.saveLocation(text);
  }, [navigation, savedFolder]);

  const scheduleSave = useCallback((delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(saveNow, delay);
  }, [saveNow]);

  useEffect(() => {
    if (!savedFolder) return;
    const unsubscribe = navigation.subscribe(() => scheduleSave(NAVIGATION_SAVE_DELAY_MS));
    const onScroll = () => scheduleSave(SCROLL_SAVE_DELAY_MS);
    const onHidden = () => { if (document.visibilityState === 'hidden') saveNow(); };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', saveNow);
    window.fbmaeSaveState = saveNow;
    return () => {
      unsubscribe();
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', saveNow);
      if (window.fbmaeSaveState === saveNow) delete window.fbmaeSaveState;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [navigation, savedFolder, saveNow, scheduleSave]);

  useEffect(() => {
    if (ready) scheduleSave(NAVIGATION_SAVE_DELAY_MS);
  }, [ready, scheduleSave]);

  return { beginRestore, skipRestore, restoring: phase !== 'done' };
}
