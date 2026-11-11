import { SafWritable } from './safHandles';
import type { AndroidNative } from './safNative';

export interface OutputSink {
  saveAs(name: string, blob: Blob): Promise<void>;
  openExternally(name: string, blob: Blob): Promise<void>;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/zip': 'zip',
  'application/pdf': 'pdf',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
};

export function nameForBlob(blob: Blob): string {
  const extension = MIME_EXTENSIONS[blob.type];
  return extension ? `attachment.${extension}` : 'attachment';
}

// Duck-typed so it works across realms (tests) and excludes MediaSource.
function isBlob(value: unknown): value is Blob {
  return typeof value === 'object' && value !== null
    && typeof (value as Blob).slice === 'function' && typeof (value as Blob).size === 'number';
}

/**
 * WebView ignores `<a download>` and cannot open blob URLs in a new tab.
 * Route both through native save-as and external-view outputs.
 */
export function installDownloadHooks(
  win: Window & typeof globalThis,
  sink: OutputSink,
  report: (error: unknown) => void = error => console.error('[Android] Output failed:', error),
): void {
  // The app revokes blob URLs about a second after clicking, so keep the Blob
  // reachable by URL until then and look it up synchronously.
  const blobs = new Map<string, Blob>();
  const urlApi = win.URL;
  const originalCreate = urlApi.createObjectURL.bind(urlApi);
  const originalRevoke = urlApi.revokeObjectURL.bind(urlApi);
  urlApi.createObjectURL = (object: Blob | MediaSource) => {
    const url = originalCreate(object);
    if (isBlob(object)) blobs.set(url, object);
    return url;
  };
  urlApi.revokeObjectURL = (url: string) => {
    blobs.delete(url);
    originalRevoke(url);
  };

  const deliver = (task: Promise<void>) => {
    void task.catch(error => {
      if ((error as { name?: string } | null)?.name !== 'AbortError') report(error);
    });
  };

  const handleAnchor = (anchor: HTMLAnchorElement): boolean => {
    if (!anchor.hasAttribute('download')) return false;
    const blob = blobs.get(anchor.href);
    if (!blob) return false;
    deliver(sink.saveAs(anchor.download || nameForBlob(blob), blob));
    return true;
  };

  const anchorPrototype = win.HTMLAnchorElement.prototype;
  const originalClick = anchorPrototype.click;
  anchorPrototype.click = function click(this: HTMLAnchorElement) {
    if (!handleAnchor(this)) originalClick.call(this);
  };

  win.document.addEventListener('click', event => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.('a[download]') as HTMLAnchorElement | null;
    if (anchor && handleAnchor(anchor)) event.preventDefault();
  }, true);

  const openBlob = (url: string): boolean => {
    const blob = blobs.get(url);
    if (!blob) return false;
    deliver(sink.openExternally(nameForBlob(blob), blob));
    return true;
  };

  const originalOpen = win.open.bind(win);
  win.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url === undefined ? '' : String(url);
    if (href === 'about:blank') return createPendingTab(openBlob) as unknown as Window;
    if (openBlob(href)) return null;
    return originalOpen(url, target, features);
  }) as typeof win.open;
}

/** Stands in for the tab the app opens before its blob URL is ready. */
function createPendingTab(openBlob: (url: string) => boolean) {
  return {
    opener: null as unknown,
    closed: false,
    close() {
      this.closed = true;
    },
    location: {
      get href() {
        return 'about:blank';
      },
      set href(value: string) {
        openBlob(value);
      },
    },
  };
}

export function createOutputSink(native: AndroidNative): OutputSink {
  const write = async (kind: 'saveAs' | 'open', name: string, blob: Blob) => {
    const writerId = await native.beginOutput(kind, name, blob.type || 'application/octet-stream');
    const writable = new SafWritable(native, writerId, () => {});
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  };
  return {
    saveAs: (name, blob) => write('saveAs', name, blob),
    openExternally: (name, blob) => write('open', name, blob),
  };
}
