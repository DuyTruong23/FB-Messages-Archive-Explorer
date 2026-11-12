// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { HOME_LOCATION, MobileNavigationController, type NavigationLocation } from '../src/services/mobileNavigation';
import { exposeAndroidBack } from '../src/platform/android/backNavigation';
import type { SelectableItem } from '../src/types/messenger';

function controller() {
  const events = new EventTarget();
  const stack: unknown[] = [null];
  let cursor = 0;
  const history = {
    scrollRestoration: 'auto' as ScrollRestoration,
    get state() { return stack[cursor]; },
    pushState: (state: unknown) => { stack.splice(cursor + 1); stack.push(state); cursor++; },
    replaceState: (state: unknown) => { stack[cursor] = state; },
    back: () => { if (cursor > 0) { cursor--; events.dispatchEvent(new Event('popstate')); } },
  };
  const nav = new MobileNavigationController({ history: history as unknown as History,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'>);
  nav.connect();
  nav.setMobile(true);
  return nav;
}

const at = (location: Partial<NavigationLocation>): NavigationLocation => ({ ...HOME_LOCATION, ...location });
const image = { category: 'photos', mediaPath: './photos/a.jpg', messageIndex: 2 } as SelectableItem;

describe('Android Back', () => {
  it('climbs from the deepest screen to the chat list and then lets the app close', () => {
    const nav = controller();
    nav.navigate(at({ screen: 'chat', chatId: 'alice' }));
    nav.navigate(at({ screen: 'info', chatId: 'alice' }));
    nav.navigate(at({ screen: 'gallery', chatId: 'alice' }));
    nav.navigate(at({ screen: 'selected', chatId: 'alice' }));
    const screens: string[] = [];
    while (nav.back()) screens.push(nav.getState().location.screen);
    expect(screens).toEqual(['gallery', 'info', 'chat', 'home']);
    expect(nav.back()).toBe(false);
  });

  it('closes an open preview before leaving its screen', () => {
    const nav = controller();
    nav.navigate(at({ screen: 'chat', chatId: 'alice' }));
    nav.openPreview({ items: [image], index: 0, source: 'chat' });
    expect(nav.back()).toBe(true);
    expect(nav.getState().location.preview).toBeUndefined();
    expect(nav.getState().location.screen).toBe('chat');
  });

  it('returns to the jump source before climbing', () => {
    const nav = controller();
    nav.navigate(at({ screen: 'gallery', chatId: 'alice' }));
    nav.navigate(at({ screen: 'chat', chatId: 'alice', messageTarget: 2 }), 'attachment');
    expect(nav.back()).toBe(true);
    expect(nav.getState().location.screen).toBe('gallery');
  });

  it('switches Settings and other lists back to Chats before closing', () => {
    const nav = controller();
    nav.navigate(at({ sidebarView: 'settings' }));
    expect(nav.back()).toBe(true);
    expect(nav.getState().location.sidebarView).toBe('chats');
    nav.navigate(at({ sidebarView: 'archived', chatListView: 'archived' }));
    expect(nav.back()).toBe(true);
    expect(nav.getState().location).toMatchObject({ sidebarView: 'chats', chatListView: 'chats' });
    expect(nav.back()).toBe(false);
  });

  it('exposes the handler to the native shell and removes it on cleanup', () => {
    const win = {} as Window;
    const back = vi.fn(() => true);
    const cleanup = exposeAndroidBack(win, { back });
    expect(win.fbmaeBack?.()).toBe(true);
    expect(back).toHaveBeenCalledOnce();
    cleanup();
    expect(win.fbmaeBack).toBeUndefined();
  });
});
