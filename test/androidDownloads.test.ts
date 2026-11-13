// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDownloadHooks, nameForBlob, type OutputSink } from '../src/platform/android/androidDownloads';

const sink = {
  saveAs: vi.fn<OutputSink['saveAs']>(async () => {}),
  openExternally: vi.fn<OutputSink['openExternally']>(async () => {}),
};
const report = vi.fn();
const originalOpen = vi.fn(() => null);
let urlCounter = 0;

beforeAll(() => {
  window.URL.createObjectURL = () => `blob:https://appassets.androidplatform.net/${++urlCounter}`;
  window.URL.revokeObjectURL = () => {};
  window.open = originalOpen as unknown as typeof window.open;
  installDownloadHooks(window, sink, report);
});

beforeEach(() => {
  sink.saveAs.mockClear();
  sink.openExternally.mockClear();
  report.mockClear();
  originalOpen.mockClear();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('installDownloadHooks', () => {
  it('saves a detached download anchor even if the URL is revoked right away', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Chat-Attachments.zip';
    anchor.click();
    window.URL.revokeObjectURL(url);
    await settle();
    expect(sink.saveAs).toHaveBeenCalledWith('Chat-Attachments.zip', blob);
  });

  it('intercepts a user tap on a rendered download link', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    const anchor = document.createElement('a');
    anchor.href = window.URL.createObjectURL(blob);
    anchor.setAttribute('download', 'photo.jpg');
    const span = document.createElement('span');
    anchor.appendChild(span);
    document.body.appendChild(anchor);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    span.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(sink.saveAs).toHaveBeenCalledWith('photo.jpg', blob);
    anchor.remove();
  });

  it('leaves anchors without a blob download alone', async () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/';
    document.body.appendChild(anchor);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    await settle();
    expect(sink.saveAs).not.toHaveBeenCalled();
    anchor.remove();
  });

  it('opens a blob URL externally', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    expect(window.open(window.URL.createObjectURL(blob), '_blank')).toBeNull();
    await settle();
    expect(sink.openExternally).toHaveBeenCalledWith('attachment.json', blob);
    expect(originalOpen).not.toHaveBeenCalled();
  });

  it('supports the about:blank tab followed by a location assignment', async () => {
    const blob = new Blob(['x'], { type: 'video/mp4' });
    const tab = window.open('about:blank', '_blank')!;
    tab.opener = null;
    tab.location.href = window.URL.createObjectURL(blob);
    await settle();
    expect(sink.openExternally).toHaveBeenCalledWith('attachment.mp4', blob);
    tab.close();
  });

  it('passes other URLs to the original window.open', () => {
    window.open('https://example.com/', '_blank', 'noopener');
    expect(originalOpen).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener');
  });

  it('reports failures except cancelled pickers', async () => {
    sink.saveAs.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    sink.saveAs.mockRejectedValueOnce(new Error('disk full'));
    for (const name of ['a.txt', 'b.txt']) {
      const anchor = document.createElement('a');
      anchor.href = window.URL.createObjectURL(new Blob(['t']));
      anchor.download = name;
      anchor.click();
    }
    await settle();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({ message: 'disk full' });
  });
});

describe('nameForBlob', () => {
  it('uses an extension for known types', () => {
    expect(nameForBlob(new Blob([], { type: 'image/png' }))).toBe('attachment.png');
    expect(nameForBlob(new Blob([]))).toBe('attachment');
  });
});
