/** The object Android injects with WebViewCompat.addWebMessageListener. */
export interface NativePort {
  postMessage(message: string | ArrayBuffer): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface NativeBridge {
  /** `timeoutMs: null` waits indefinitely, for calls that show a system picker. */
  call<T>(method: string, args?: Record<string, unknown>, timeoutMs?: number | null): Promise<T>;
  sendChunk(writerId: number, bytes: Uint8Array): Promise<void>;
  readonly binary: boolean;
}

interface Reply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { name?: string; message?: string };
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
}

export const NATIVE_TIMEOUT_MS = 60_000;

export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(text);
}

export async function connectNativeBridge(port: NativePort, timeoutMs = NATIVE_TIMEOUT_MS): Promise<NativeBridge> {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  port.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    let reply: Reply;
    try {
      reply = JSON.parse(event.data) as Reply;
    } catch {
      return;
    }
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (entry.timer !== null) clearTimeout(entry.timer);
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(new DOMException(reply.error?.message ?? 'The native call failed.', reply.error?.name ?? 'UnknownError'));
  });

  function track<T>(id: number, method: string, limit: number | null): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = limit === null ? null : setTimeout(() => {
        pending.delete(id);
        reject(new DOMException(`${method} did not respond.`, 'TimeoutError'));
      }, limit);
      pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    });
  }

  function call<T>(method: string, args: Record<string, unknown> = {}, limit: number | null = timeoutMs): Promise<T> {
    const id = nextId++;
    const result = track<T>(id, method, limit);
    port.postMessage(JSON.stringify({ id, method, args }));
    return result;
  }

  const hello = await call<{ binary?: boolean }>('hello');
  const binary = hello?.binary === true;

  async function sendChunk(writerId: number, bytes: Uint8Array): Promise<void> {
    if (!binary) {
      await call('writeChunk', { writerId, base64: bytesToBase64(bytes) });
      return;
    }
    const id = nextId++;
    const result = track<void>(id, 'writeChunk', timeoutMs);
    const frame = new Uint8Array(8 + bytes.byteLength);
    const header = new DataView(frame.buffer);
    header.setUint32(0, id, true);
    header.setUint32(4, writerId, true);
    frame.set(bytes, 8);
    port.postMessage(frame.buffer);
    await result;
  }

  return { call, sendChunk, binary };
}
