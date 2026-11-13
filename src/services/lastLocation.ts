import type { MobileScreen, NavigationLocation, NavigationSnapshot, SidebarView } from './mobileNavigation';

/** Where the user was when they last left the app: screen, open chat and scroll positions. */
export interface SavedLocation {
  version: 1;
  folder: string;
  location: NavigationLocation;
  snapshot: NavigationSnapshot;
}

const SCREENS: readonly MobileScreen[] = ['home', 'chat', 'info', 'gallery', 'selected'];
const SIDEBAR_VIEWS: readonly SidebarView[] = ['chats', 'settings', 'archived', 'requests'];
const CHAT_LIST_VIEWS: readonly string[] = ['chats', 'archived', 'requests'];

/**
 * Keeps only what can be rebuilt after a restart. Previews, jump targets and the selection
 * screen depend on in-memory state, so they fall back to the screen underneath.
 */
export function toSavedLocation(folder: string, location: NavigationLocation, snapshot: NavigationSnapshot): SavedLocation {
  const { preview: _preview, messageTarget: _messageTarget, attachmentTarget: _attachmentTarget, ...kept } = location;
  const screen = !kept.chatId ? 'home' : kept.screen === 'selected' ? 'gallery' : kept.screen;
  const { message, gallery, sidebarScroll, infoScroll } = snapshot;
  return {
    version: 1,
    folder,
    location: { ...kept, screen },
    snapshot: { message, gallery, sidebarScroll, infoScroll },
  };
}

function isNumberOrUndefined(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

export function parseSavedLocation(text: string | null, folder: string): SavedLocation | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const saved = value as Partial<SavedLocation> | null;
  if (!saved || saved.version !== 1 || saved.folder !== folder) return null;
  const location = saved.location as Partial<NavigationLocation> | undefined;
  if (!location || !SCREENS.includes(location.screen as MobileScreen)
    || !SIDEBAR_VIEWS.includes(location.sidebarView as SidebarView)
    || !CHAT_LIST_VIEWS.includes(location.chatListView as string)
    || typeof location.galleryTab !== 'string'
    || (location.chatId !== undefined && typeof location.chatId !== 'string')) return null;
  const snapshot = (saved.snapshot && typeof saved.snapshot === 'object' ? saved.snapshot : {}) as NavigationSnapshot;
  if (!isNumberOrUndefined(snapshot.sidebarScroll) || !isNumberOrUndefined(snapshot.infoScroll)) return null;
  return toSavedLocation(folder, location as NavigationLocation, snapshot);
}
