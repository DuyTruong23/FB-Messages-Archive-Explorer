declare global {
  interface Window {
    /** Called by the Android shell on system Back. Returns false when the app should close. */
    fbmaeBack?: () => boolean;
  }
}

// Layers that close on Escape and sit above the navigation screens. The media viewer is
// included because its own Escape handler closes an expanded image or its menu first.
const LAYER_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '.delete-modal',
  '.media-viewer-overlay',
  '.overlay-panel',
  '.chat-item-dropdown',
  '.message-selection-bar',
].join(',');

/** Sends Escape to the open layer. Returns false when nothing is open. */
export function dismissTopLayer(doc: Document): boolean {
  if (!doc.querySelector(LAYER_SELECTOR)) return false;
  const target = doc.activeElement instanceof HTMLElement ? doc.activeElement : doc.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  return true;
}

export function exposeAndroidBack(win: Window, navigation: { back(): boolean }): () => void {
  win.fbmaeBack = () => dismissTopLayer(win.document) || navigation.back();
  return () => { delete win.fbmaeBack; };
}
