import type { NativeBridge } from './nativeBridge';
import type { SafEntry, SafNative } from './safHandles';

export interface PickedTree extends SafEntry {
  treeUri: string;
}

export interface AndroidNative extends SafNative {
  pickDirectory(mode: 'read' | 'readwrite'): Promise<PickedTree>;
  /** The folder saved with rememberDirectory, or null when there is none or it is no longer granted. */
  restoreDirectory(): Promise<PickedTree | null>;
  rememberDirectory(treeUri: string): Promise<void>;
  /** Small app state kept in SharedPreferences, which survives the process being killed right after leaving the app. */
  readNavigation(): Promise<string | null>;
  writeNavigation(value: string): Promise<void>;
  /** Opens a writer for a save-as document (system picker) or an external-view cache file. */
  beginOutput(kind: 'saveAs' | 'open', name: string, mimeType: string): Promise<number>;
}

/** base64url without padding, so the URI survives as one path segment. */
export function encodeSafPath(uri: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(uri)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createAndroidNative(bridge: NativeBridge, fetchImpl: typeof fetch = (...args) => fetch(...args)): AndroidNative {
  return {
    pickDirectory: mode => bridge.call<PickedTree>('pickDirectory', { mode }, null),
    restoreDirectory: async () => {
      const saved = await bridge.call<Partial<PickedTree> | null>('restoreDirectory');
      return saved?.treeUri ? saved as PickedTree : null;
    },
    rememberDirectory: async treeUri => {
      await bridge.call('rememberDirectory', { treeUri });
    },
    readNavigation: async () => {
      const saved = await bridge.call<{ value?: unknown } | null>('readNavigation');
      return typeof saved?.value === 'string' ? saved.value : null;
    },
    writeNavigation: async value => {
      await bridge.call('writeNavigation', { value });
    },
    listChildren: async (treeUri, uri) => (await bridge.call<{ entries: SafEntry[] }>('listChildren', { treeUri, uri })).entries,
    createDocument: (treeUri, parentUri, name, directory) => bridge.call<SafEntry>('createDocument', { treeUri, parentUri, name, directory }),
    deleteDocument: async (treeUri, uri) => {
      await bridge.call('deleteDocument', { treeUri, uri });
    },
    openWriter: async (treeUri, uri) => (await bridge.call<{ writerId: number }>('openWriter', { treeUri, uri })).writerId,
    beginOutput: async (kind, name, mimeType) => (await bridge.call<{ writerId: number }>(
      'beginOutput', { kind, name, mimeType }, kind === 'saveAs' ? null : undefined,
    )).writerId,
    writeChunk: (writerId, bytes) => bridge.sendChunk(writerId, bytes),
    closeWriter: async writerId => {
      await bridge.call('closeWriter', { writerId });
    },
    abortWriter: async writerId => {
      await bridge.call('abortWriter', { writerId });
    },
    readFile: async uri => {
      const response = await fetchImpl(`/saf/${encodeSafPath(uri)}`);
      if (response.status === 403) throw new DOMException('Access to the file was denied.', 'NotAllowedError');
      if (response.status === 404) throw new DOMException('The file was not found.', 'NotFoundError');
      if (!response.ok) throw new DOMException(`The file could not be read (${response.status}).`, 'NotReadableError');
      return response.blob();
    },
  };
}
