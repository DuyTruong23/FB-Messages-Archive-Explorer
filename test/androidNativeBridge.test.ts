import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64, connectNativeBridge, type NativePort } from '../src/platform/android/nativeBridge';

class FakePort implements NativePort {
  sent: Array<string | ArrayBuffer> = [];
  private listeners: Array<(event: { data: unknown }) => void> = [];

  constructor(private readonly binary = true) {}

  postMessage(message: string | ArrayBuffer): void {
    this.sent.push(message);
    if (typeof message !== 'string') return;
    const request = JSON.parse(message) as { id: number; method: string };
    if (request.method === 'hello') {
      queueMicrotask(() => this.reply({ id: request.id, ok: true, result: { binary: this.binary } }));
    }
  }

  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.push(listener);
  }

  reply(value: unknown): void {
    for (const listener of this.listeners) listener({ data: JSON.stringify(value) });
  }

  lastRequest(): { id: number; method: string; args: Record<string, unknown> } {
    return JSON.parse(this.sent.at(-1) as string);
  }
}

describe('connectNativeBridge', () => {
  afterEach(() => vi.useRealTimers());

  it('reads binary support from the hello handshake', async () => {
    expect((await connectNativeBridge(new FakePort(true))).binary).toBe(true);
    expect((await connectNativeBridge(new FakePort(false))).binary).toBe(false);
  });

  it('resolves a call with its result', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port);
    const result = bridge.call<{ entries: string[] }>('listChildren', { uri: 'a' });
    const request = port.lastRequest();
    expect(request).toMatchObject({ method: 'listChildren', args: { uri: 'a' } });
    port.reply({ id: request.id, ok: true, result: { entries: ['x'] } });
    await expect(result).resolves.toEqual({ entries: ['x'] });
  });

  it('rejects a call with a DOMException carrying the native error name', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port);
    const result = bridge.call('deleteDocument');
    port.reply({ id: port.lastRequest().id, ok: false, error: { name: 'NotAllowedError', message: 'denied' } });
    await expect(result).rejects.toMatchObject({ name: 'NotAllowedError', message: 'denied' });
  });

  it('times out a call without a reply', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port, 1000);
    vi.useFakeTimers();
    const result = bridge.call('listChildren');
    vi.advanceTimersByTime(1001);
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('never times out a call with a null timeout', async () => {
    const port = new FakePort();
    const bridge = await connectNativeBridge(port, 1000);
    vi.useFakeTimers();
    let settled = false;
    const result = bridge.call('pickDirectory', {}, null).finally(() => { settled = true; });
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(settled).toBe(false);
    port.reply({ id: port.lastRequest().id, ok: true, result: {} });
    await result;
  });

  it('sends a binary frame with request id, writer id, and payload', async () => {
    const port = new FakePort(true);
    const bridge = await connectNativeBridge(port);
    const sent = bridge.sendChunk(7, new Uint8Array([1, 2, 3]));
    const frame = new Uint8Array(port.sent.at(-1) as ArrayBuffer);
    const view = new DataView(frame.buffer);
    const requestId = view.getUint32(0, true);
    expect(view.getUint32(4, true)).toBe(7);
    expect([...frame.subarray(8)]).toEqual([1, 2, 3]);
    port.reply({ id: requestId, ok: true, result: {} });
    await expect(sent).resolves.toBeUndefined();
  });

  it('falls back to base64 chunks without binary support', async () => {
    const port = new FakePort(false);
    const bridge = await connectNativeBridge(port);
    const sent = bridge.sendChunk(3, new Uint8Array([104, 105]));
    const request = port.lastRequest();
    expect(request).toMatchObject({ method: 'writeChunk', args: { writerId: 3, base64: 'aGk=' } });
    port.reply({ id: request.id, ok: true, result: {} });
    await expect(sent).resolves.toBeUndefined();
  });
});

describe('bytesToBase64', () => {
  it('encodes large arrays without exceeding the argument limit', () => {
    const bytes = new Uint8Array(200_000).fill(65);
    expect(atob(bytesToBase64(bytes))).toBe('A'.repeat(200_000));
  });
});
