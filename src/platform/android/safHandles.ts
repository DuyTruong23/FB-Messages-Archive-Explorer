import type { ReadableEntryHandle, WritableDirectoryHandle, WritableFileHandle } from '../../types/fileSystem';

/** One document as the Android Storage Access Framework reports it. */
export interface SafEntry {
  uri: string;
  name: string;
  directory: boolean;
  mimeType: string;
  size: number;
  lastModified: number;
}

/** Native operations the handles need. Tests pass an in-memory version. */
export interface SafNative {
  listChildren(treeUri: string, uri: string): Promise<SafEntry[]>;
  createDocument(treeUri: string, parentUri: string, name: string, directory: boolean): Promise<SafEntry>;
  deleteDocument(treeUri: string, uri: string): Promise<void>;
  openWriter(treeUri: string, uri: string): Promise<number>;
  writeChunk(writerId: number, bytes: Uint8Array): Promise<void>;
  closeWriter(writerId: number): Promise<void>;
  abortWriter(writerId: number): Promise<void>;
  readFile(uri: string): Promise<Blob>;
}

export const SAF_CHUNK_BYTES = 1024 * 1024;

type WriteData = string | Blob | ArrayBuffer | ArrayBufferView;
type WriteInput = WriteData | { type: 'write'; data: WriteData };

function assertValidName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Invalid name: ${name}`);
  }
}

function isWriteCommand(input: WriteInput): input is { type: 'write'; data: WriteData } {
  return typeof input === 'object' && input !== null && !(input instanceof Blob)
    && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer)
    && (input as { type?: unknown }).type === 'write';
}

async function* chunksOf(data: WriteData): AsyncGenerator<Uint8Array> {
  if (data instanceof Blob) {
    for (let offset = 0; offset < data.size; offset += SAF_CHUNK_BYTES) {
      yield new Uint8Array(await data.slice(offset, offset + SAF_CHUNK_BYTES).arrayBuffer());
    }
    return;
  }
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += SAF_CHUNK_BYTES) {
    yield bytes.subarray(offset, offset + SAF_CHUNK_BYTES);
  }
}

/** The subset of FileSystemWritableFileStream the app uses: write, close, abort. */
export class SafWritable {
  private open = true;
  private queue: Promise<void> = Promise.resolve();
  private readonly native: SafNative;
  private readonly writerId: number;
  private readonly onClosed: () => void;

  constructor(native: SafNative, writerId: number, onClosed: () => void) {
    this.native = native;
    this.writerId = writerId;
    this.onClosed = onClosed;
  }

  write(input: WriteInput): Promise<void> {
    return this.enqueue(async () => {
      const data = isWriteCommand(input) ? input.data : input;
      for await (const chunk of chunksOf(data)) {
        await this.native.writeChunk(this.writerId, chunk);
      }
    });
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      this.open = false;
      await this.native.closeWriter(this.writerId);
      this.onClosed();
    });
  }

  abort(): Promise<void> {
    return this.enqueue(async () => {
      this.open = false;
      await this.native.abortWriter(this.writerId);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => {
      if (!this.open) throw new DOMException('The writer is closed.', 'InvalidStateError');
      return task();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export class SafFileHandle implements WritableFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  readonly entry: SafEntry;
  private readonly native: SafNative;
  private readonly parent: SafDirectoryHandle;

  constructor(native: SafNative, parent: SafDirectoryHandle, entry: SafEntry) {
    this.native = native;
    this.parent = parent;
    this.entry = entry;
    this.name = entry.name;
  }

  async getFile(): Promise<File> {
    const blob = await this.native.readFile(this.entry.uri);
    const type = this.entry.mimeType === 'application/octet-stream' ? '' : this.entry.mimeType;
    return new File([blob], this.name, { type, lastModified: this.entry.lastModified });
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const writerId = await this.native.openWriter(this.parent.treeUri, this.entry.uri);
    const writable = new SafWritable(this.native, writerId, () => this.parent.invalidate());
    return writable as unknown as FileSystemWritableFileStream;
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof SafFileHandle && other.entry.uri === this.entry.uri;
  }
}

export class SafDirectoryHandle implements WritableDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  readonly treeUri: string;
  readonly entry: SafEntry;
  private readonly native: SafNative;
  private children: Promise<Map<string, SafEntry>> | null = null;

  constructor(native: SafNative, treeUri: string, entry: SafEntry) {
    this.native = native;
    this.treeUri = treeUri;
    this.entry = entry;
    this.name = entry.name;
  }

  invalidate(): void {
    this.children = null;
  }

  async *entries(): AsyncIterableIterator<[string, ReadableEntryHandle]> {
    for (const child of (await this.loadChildren()).values()) {
      yield [child.name, this.wrap(child)];
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const child of (await this.loadChildren()).values()) yield child.name;
  }

  async *values(): AsyncIterableIterator<ReadableEntryHandle> {
    for (const child of (await this.loadChildren()).values()) yield this.wrap(child);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, ReadableEntryHandle]> {
    return this.entries();
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<SafDirectoryHandle> {
    const entry = await this.child(name, true, options.create === true);
    return new SafDirectoryHandle(this.native, this.treeUri, entry);
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<SafFileHandle> {
    const entry = await this.child(name, false, options.create === true);
    return new SafFileHandle(this.native, this, entry);
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    assertValidName(name);
    const existing = (await this.loadChildren()).get(name);
    if (!existing) throw new DOMException(`${name} was not found.`, 'NotFoundError');
    if (existing.directory && !options.recursive) {
      const grandchildren = await this.native.listChildren(this.treeUri, existing.uri);
      if (grandchildren.length > 0) throw new DOMException(`${name} is not empty.`, 'InvalidModificationError');
    }
    await this.native.deleteDocument(this.treeUri, existing.uri);
    this.invalidate();
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof SafDirectoryHandle && other.entry.uri === this.entry.uri;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }

  private async child(name: string, directory: boolean, create: boolean): Promise<SafEntry> {
    assertValidName(name);
    const existing = (await this.loadChildren()).get(name);
    if (existing) {
      if (existing.directory !== directory) {
        throw new DOMException(`${name} is a ${existing.directory ? 'directory' : 'file'}.`, 'TypeMismatchError');
      }
      return existing;
    }
    if (!create) throw new DOMException(`${name} was not found.`, 'NotFoundError');
    const created = await this.native.createDocument(this.treeUri, this.entry.uri, name, directory);
    this.invalidate();
    return created;
  }

  private loadChildren(): Promise<Map<string, SafEntry>> {
    if (!this.children) {
      const loading = this.native.listChildren(this.treeUri, this.entry.uri)
        .then(entries => new Map(entries.map(child => [child.name, child] as const)));
      loading.catch(() => {
        if (this.children === loading) this.children = null;
      });
      this.children = loading;
    }
    return this.children;
  }

  private wrap(child: SafEntry): SafDirectoryHandle | SafFileHandle {
    return child.directory
      ? new SafDirectoryHandle(this.native, this.treeUri, child)
      : new SafFileHandle(this.native, this, child);
  }
}
