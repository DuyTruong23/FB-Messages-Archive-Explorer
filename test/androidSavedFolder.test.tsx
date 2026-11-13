// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useArchive } from '../src/hooks/useArchive';
import type { NativeBridge } from '../src/platform/android/nativeBridge';
import { createAndroidNative } from '../src/platform/android/safNative';
import { SafDirectoryHandle } from '../src/platform/android/safHandles';
import { createSavedFolder } from '../src/platform/android/savedFolder';
import { createMockDirectoryHandle } from './helpers/mockFileSystem';

if (!File.prototype.text) {
  File.prototype.text = function text() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

const root = { uri: 'tree/document/root', name: 'fb', directory: true, mimeType: 'vnd.android.document/directory', size: 0, lastModified: 0 };

function fakeBridge(handler: (method: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const bridge: NativeBridge = {
    binary: true,
    async call<T>(method: string, args: Record<string, unknown> = {}) {
      calls.push({ method, args });
      return handler(method, args) as T;
    },
    sendChunk: vi.fn(async () => {}),
  };
  return { native: createAndroidNative(bridge), calls };
}

function facebookRoot() {
  return createMockDirectoryHandle('export', {
    messages: {
      inbox: {
        chat: {
          'message_1.json': JSON.stringify({
            title: 'Chat', thread_path: 'inbox/chat', participants: [{ name: 'Alice' }],
            messages: [{ sender_name: 'Alice', timestamp_ms: 1, content: 'hi' }],
          }),
        },
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Android saved folder', () => {
  it('restores the saved tree as a SAF directory handle', async () => {
    const { native, calls } = fakeBridge(() => ({ ...root, treeUri: 'tree' }));
    const handle = await createSavedFolder(native).restore();
    expect(handle).toBeInstanceOf(SafDirectoryHandle);
    expect(handle).toMatchObject({ name: 'fb', treeUri: 'tree' });
    expect(calls).toEqual([{ method: 'restoreDirectory', args: {} }]);
  });

  it('returns null when nothing is saved or the native call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(createSavedFolder(fakeBridge(() => ({})).native).restore()).resolves.toBeNull();
    await expect(createSavedFolder(fakeBridge(() => { throw new DOMException('denied', 'SecurityError'); }).native).restore())
      .resolves.toBeNull();
  });

  it('remembers SAF folders only', async () => {
    const { native, calls } = fakeBridge(() => ({}));
    const saved = createSavedFolder(native);
    await saved.remember(createMockDirectoryHandle('web', {}));
    await saved.remember(new SafDirectoryHandle(native, 'tree', root));
    expect(calls).toEqual([{ method: 'rememberDirectory', args: { treeUri: 'tree' } }]);
  });
});

describe('Android saved location', () => {
  it('reads and writes the navigation string through the bridge', async () => {
    const { native, calls } = fakeBridge(method => method === 'readNavigation' ? { value: '{"version":1}' } : {});
    const saved = createSavedFolder(native);
    await expect(saved.loadLocation()).resolves.toBe('{"version":1}');
    await saved.saveLocation('{"version":1,"x":2}');
    expect(calls).toEqual([
      { method: 'readNavigation', args: {} },
      { method: 'writeNavigation', args: { value: '{"version":1,"x":2}' } },
    ]);
  });

  it('treats a missing value or a failed read as nothing saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(createSavedFolder(fakeBridge(() => ({ value: null })).native).loadLocation()).resolves.toBeNull();
    await expect(createSavedFolder(fakeBridge(() => { throw new Error('gone'); }).native).loadLocation()).resolves.toBeNull();
  });
});

describe('useArchive folder source', () => {
  it('opens the supplied folder without the picker and reports it once listed', async () => {
    const picker = vi.fn();
    Object.defineProperty(window, 'showDirectoryPicker', { value: picker, configurable: true, writable: true });
    try {
      const folder = facebookRoot();
      const onOpened = vi.fn();
      const { result, unmount } = renderHook(() => useArchive(false));
      await act(async () => {
        await result.current.openFolder(false, undefined, 'native', { pick: async () => folder, onOpened });
      });
      expect(picker).not.toHaveBeenCalled();
      expect(result.current.inboxList.map(entry => entry.title)).toEqual(['Chat']);
      expect(onOpened).toHaveBeenCalledWith(folder);
      unmount();
    } finally {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    }
  });

  it('does not report folders that fail to open and stays quiet on AbortError', async () => {
    const onOpened = vi.fn();
    const { result, unmount } = renderHook(() => useArchive(false));
    await act(async () => {
      await result.current.openFolder(false, undefined, 'native', { pick: async () => createMockDirectoryHandle('empty', {}), onOpened });
    });
    expect(result.current.error).toMatch(/Could not find messages/);
    expect(onOpened).not.toHaveBeenCalled();

    let handled = true;
    await act(async () => {
      handled = await result.current.openFolder(false, undefined, 'native', {
        pick: async () => { throw new DOMException('No saved folder', 'AbortError'); }, onOpened,
      });
    });
    expect(handled).toBe(false);
    expect(onOpened).not.toHaveBeenCalled();
    unmount();
  });
});
