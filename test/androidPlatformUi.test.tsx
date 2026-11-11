// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FolderAccessOptions } from '../src/components/Sidebar/FolderAccessOptions';
import { pickFolderWithWriteAccess, pickMessagesFolder } from '../src/services/fileSystem';

describe('Android app UI', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('hides folder access options in the Android app', () => {
    vi.stubEnv('MODE', 'android');
    const { container } = render(<FolderAccessOptions mode="upload" onChange={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps folder access options on the web', () => {
    const { getAllByText } = render(<FolderAccessOptions mode="native" onChange={() => {}} />);
    expect(getAllByText('Folder access').length).toBeGreaterThan(0);
  });

  it('uses the native picker in the Android app even when upload mode is saved', async () => {
    vi.stubEnv('MODE', 'android');
    const handle = { kind: 'directory', name: 'root' };
    const picker = vi.fn().mockResolvedValue(handle);
    // Set it on the jsdom window itself; it may not be the same object as globalThis.
    Object.defineProperty(window, 'showDirectoryPicker', { value: picker, configurable: true, writable: true });
    try {
      await expect(pickMessagesFolder('upload')).resolves.toBe(handle);
      await expect(pickFolderWithWriteAccess('upload')).resolves.toBe(handle);
      expect(picker).toHaveBeenNthCalledWith(1, { id: 'messages-folder', mode: 'read' });
      expect(picker).toHaveBeenNthCalledWith(2, { id: 'messages-folder', mode: 'readwrite' });
    } finally {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    }
  });
});
