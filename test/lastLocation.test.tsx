// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLastLocation } from '../src/hooks/useLastLocation';
import { parseSavedLocation, toSavedLocation } from '../src/services/lastLocation';
import { HOME_LOCATION, MobileNavigationController, type NavigationLocation } from '../src/services/mobileNavigation';
import type { SavedFolder } from '../src/platform/android/savedFolder';
import type { ChatListEntry, MessengerThread } from '../src/types/messenger';

const FOLDER = 'content://tree/fb';
const entry = { folderName: 'alice_1', title: 'Alice', participants: ['Alice'], messageCount: 1, folderSize: 1, jsonFileCount: 1,
  source: 'inbox', dirHandle: { kind: 'directory', name: 'alice_1' } } as ChatListEntry;
const CHAT_ID = 'facebook:inbox:alice_1';
const chatLocation: NavigationLocation = { ...HOME_LOCATION, screen: 'chat', chatId: CHAT_ID };
const message = { index: 40, offset: 12, scrollTop: 900, atBottom: false };

function controller() {
  const history = { scrollRestoration: 'auto', state: null, pushState: vi.fn(), replaceState: vi.fn(), back: vi.fn() };
  const events = new EventTarget();
  const navigation = new MobileNavigationController({ history: history as unknown as History,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  } as Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>);
  navigation.setMobile(true);
  return navigation;
}

function fakeFolder(saved: string | null) {
  const writes: string[] = [];
  const folder: SavedFolder = {
    restore: vi.fn(async () => null),
    remember: vi.fn(async () => {}),
    loadLocation: vi.fn(async () => saved),
    saveLocation: vi.fn(async (value: string) => { writes.push(value); }),
  };
  return { folder, writes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('saved location format', () => {
  it('drops in-memory targets and falls back to screens that can be rebuilt', () => {
    const saved = toSavedLocation(FOLDER, { ...chatLocation, screen: 'selected', messageTarget: 3, attachmentTarget: 'k',
      preview: { keys: ['k'], currentKey: 'k', source: 'gallery' } }, { message, selectedScroll: 5 });
    expect(saved.location).toEqual({ ...HOME_LOCATION, screen: 'gallery', chatId: CHAT_ID });
    expect(saved.snapshot).toEqual({ message, gallery: undefined, sidebarScroll: undefined, infoScroll: undefined });
    expect(toSavedLocation(FOLDER, { ...HOME_LOCATION, screen: 'chat' }, {}).location.screen).toBe('home');
  });

  it('round-trips through JSON and rejects another folder or malformed data', () => {
    const text = JSON.stringify(toSavedLocation(FOLDER, chatLocation, { message, sidebarScroll: 30 }));
    expect(parseSavedLocation(text, FOLDER)).toMatchObject({ location: chatLocation, snapshot: { message, sidebarScroll: 30 } });
    expect(parseSavedLocation(text, 'content://tree/other')).toBeNull();
    expect(parseSavedLocation('{', FOLDER)).toBeNull();
    expect(parseSavedLocation(null, FOLDER)).toBeNull();
    expect(parseSavedLocation(JSON.stringify({ version: 1, folder: FOLDER, location: { ...chatLocation, screen: 'nowhere' } }), FOLDER)).toBeNull();
    expect(parseSavedLocation(JSON.stringify({ version: 1, folder: FOLDER, location: { ...chatLocation, chatListView: 'settings' } }), FOLDER)).toBeNull();
  });
});

describe('MobileNavigationController.restore', () => {
  it('publishes the saved location as a restoration with a fresh history', () => {
    const navigation = controller();
    navigation.navigate({ ...HOME_LOCATION, sidebarView: 'settings' });
    const before = navigation.getState().revision;
    navigation.restore(chatLocation, { message });
    expect(navigation.getState()).toMatchObject({ location: chatLocation, snapshot: { message }, restoring: true, revision: before + 1 });
    expect(navigation.back()).toBe(true);
    expect(navigation.getState().location.screen).toBe('home');
    expect(navigation.back()).toBe(false);
  });
});

describe('useLastLocation', () => {
  type Props = Parameters<typeof useLastLocation>[0];
  function setup(saved: string | null, overrides: Partial<Props> = {}) {
    const navigation = controller();
    const { folder, writes } = fakeFolder(saved);
    const props: Props = { navigation, savedFolder: folder, folderKey: null, archiveList: [], archiveLoading: true,
      activeEntry: null, chatLoading: false, chatData: null, ...overrides };
    const view = renderHook((current: Props) => useLastLocation(current), { initialProps: props });
    return { navigation, folder, writes, view, props };
  }

  it('reopens the saved chat and scroll position once the chat list contains it', async () => {
    const saved = JSON.stringify(toSavedLocation(FOLDER, chatLocation, { message }));
    const { navigation, view, props, writes } = setup(saved);
    await act(async () => { view.result.current.beginRestore(FOLDER); });
    expect(navigation.getState().location.screen).toBe('home');
    view.rerender({ ...props, folderKey: FOLDER, archiveList: [entry], archiveLoading: false });
    expect(navigation.getState()).toMatchObject({ location: chatLocation, snapshot: { message }, restoring: true });
    expect(view.result.current.restoring).toBe(true);
    expect(writes).toEqual([]);
  });

  it('stays on the chat list when the saved chat is gone', async () => {
    const saved = JSON.stringify(toSavedLocation(FOLDER, chatLocation, { message }));
    const { navigation, view, props } = setup(saved);
    await act(async () => { view.result.current.beginRestore(FOLDER); });
    view.rerender({ ...props, folderKey: FOLDER, archiveList: [{ ...entry, folderName: 'bob_2' }], archiveLoading: false });
    expect(navigation.getState().location).toEqual(HOME_LOCATION);
    expect(view.result.current.restoring).toBe(false);
  });

  it('saves the location after navigation, and immediately when the Android shell pauses', async () => {
    vi.useFakeTimers();
    const { navigation, view, props, writes } = setup(null);
    act(() => { view.result.current.skipRestore(); });
    view.rerender({ ...props, folderKey: FOLDER, archiveList: [entry], archiveLoading: false,
      activeEntry: entry, chatData: {} as MessengerThread });
    act(() => { navigation.navigate(chatLocation); });
    navigation.capture = () => ({ message });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(writes.map(text => JSON.parse(text))).toEqual([
      expect.objectContaining({ folder: FOLDER, location: chatLocation, snapshot: expect.objectContaining({ message }) }),
    ]);

    navigation.capture = () => ({ message: { ...message, index: 41 } });
    act(() => { window.fbmaeSaveState?.(); });
    expect(JSON.parse(writes.at(-1)!).snapshot.message.index).toBe(41);
  });

  it('does not save before the restore settles or without an open folder', async () => {
    vi.useFakeTimers();
    const { navigation, view, props, writes } = setup(null);
    act(() => { navigation.navigate(chatLocation); window.fbmaeSaveState?.(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    act(() => { view.result.current.skipRestore(); });
    act(() => { window.fbmaeSaveState?.(); });
    expect(writes).toEqual([]);
    view.rerender({ ...props, folderKey: FOLDER, archiveLoading: false });
    act(() => { window.fbmaeSaveState?.(); });
    expect(writes).toHaveLength(1);
  });
});
