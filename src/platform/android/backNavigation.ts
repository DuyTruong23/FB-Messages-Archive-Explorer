declare global {
  interface Window {
    /** Called by the Android shell on system Back. Returns false when the app should close. */
    fbmaeBack?: () => boolean;
  }
}

export function exposeAndroidBack(win: Window, navigation: { back(): boolean }): () => void {
  win.fbmaeBack = () => navigation.back();
  return () => { delete win.fbmaeBack; };
}
