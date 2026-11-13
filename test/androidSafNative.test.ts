import { describe, expect, it, vi } from 'vitest';
import type { NativeBridge } from '../src/platform/android/nativeBridge';
import { createAndroidNative, encodeSafPath } from '../src/platform/android/safNative';
import { createDirectoryPicker } from '../src/platform/android/install';
import { SafDirectoryHandle } from '../src/platform/android/safHandles';

function fakeBridge(results: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args: Record<string, unknown>; timeout: number | null | undefined }> = [];
  const bridge: NativeBridge = {
    binary: true,
    async call<T>(method: string, args: Record<string, unknown> = {}, timeout?: number | null) {
      calls.push({ method, args, timeout });
      return results[method] as T;
    },
    sendChunk: vi.fn(async () => {}),
  };
  return { bridge, calls };
}

function decodeSafPath(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

describe('encodeSafPath', () => {
  it('round-trips document URIs with escapes and Unicode', () => {
    const uri = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2Ffb/document/primary%3ADownload%2Ffb%2FTôi.json';
    const encoded = encodeSafPath(uri);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSafPath(encoded)).toBe(uri);
  });
});

describe('createAndroidNative', () => {
  it('waits indefinitely for pickers and uses the default timeout otherwise', async () => {
    const { bridge, calls } = fakeBridge({ pickDirectory: { treeUri: 't' }, beginOutput: { writerId: 4 }, listChildren: { entries: [] } });
    const native = createAndroidNative(bridge);
    await native.pickDirectory('readwrite');
    await native.beginOutput('saveAs', 'a.zip', 'application/zip');
    await native.beginOutput('open', 'a.json', 'application/json');
    await native.listChildren('t', 'u');
    expect(calls.map(call => [call.method, call.timeout])).toEqual([
      ['pickDirectory', null],
      ['beginOutput', null],
      ['beginOutput', undefined],
      ['listChildren', undefined],
    ]);
  });

  it('unwraps entries and writer ids', async () => {
    const entry = { uri: 'u', name: 'a', directory: false, mimeType: 'text/plain', size: 1, lastModified: 1 };
    const { bridge } = fakeBridge({ listChildren: { entries: [entry] }, openWriter: { writerId: 9 } });
    const native = createAndroidNative(bridge);
    await expect(native.listChildren('t', 'u')).resolves.toEqual([entry]);
    await expect(native.openWriter('t', 'u')).resolves.toBe(9);
  });

  it('reads files from the /saf/ path and maps HTTP errors', async () => {
    const { bridge } = fakeBridge();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(encodeSafPath('denied'))) return new Response('', { status: 403 });
      if (path.endsWith(encodeSafPath('missing'))) return new Response('', { status: 404 });
      return new Response('bytes', { status: 200 });
    });
    const native = createAndroidNative(bridge, fetchImpl as unknown as typeof fetch);
    await expect((await native.readFile('ok')).text()).resolves.toBe('bytes');
    expect(fetchImpl).toHaveBeenCalledWith(`/saf/${encodeSafPath('ok')}`);
    await expect(native.readFile('denied')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(native.readFile('missing')).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('createDirectoryPicker', () => {
  it('returns a SAF directory handle rooted at the picked tree', async () => {
    const picked = { treeUri: 'tree', uri: 'tree/document/root', name: 'fb', directory: true, mimeType: 'vnd.android.document/directory', size: 0, lastModified: 0 };
    const { bridge, calls } = fakeBridge({ pickDirectory: picked });
    const handle = await createDirectoryPicker(createAndroidNative(bridge))({ mode: 'readwrite' });
    expect(handle).toBeInstanceOf(SafDirectoryHandle);
    expect(handle.name).toBe('fb');
    expect(handle.treeUri).toBe('tree');
    expect(calls[0]).toMatchObject({ method: 'pickDirectory', args: { mode: 'readwrite' } });
  });
});
