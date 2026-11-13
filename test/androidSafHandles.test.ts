import { describe, expect, it } from 'vitest';
import { SAF_CHUNK_BYTES, SafDirectoryHandle, SafWritable, type SafEntry, type SafNative } from '../src/platform/android/safHandles';

interface Node { entry: SafEntry; parent: string | null; data: Uint8Array }

function makeFake() {
  const nodes = new Map<string, Node>();
  const writers = new Map<number, { uri: string; parts: Uint8Array[] }>();
  const chunkSizes: number[] = [];
  let nextWriter = 1;
  let listCalls = 0;

  const add = (parent: string | null, name: string, directory: boolean, text = ''): SafEntry => {
    const uri = parent ? `${parent}/${name}` : name;
    const data = new TextEncoder().encode(text);
    const entry: SafEntry = {
      uri, name, directory,
      mimeType: directory ? 'vnd.android.document/directory' : 'application/json',
      size: data.byteLength, lastModified: 1,
    };
    nodes.set(uri, { entry, parent, data });
    return entry;
  };

  const native: SafNative = {
    async listChildren(_tree, uri) {
      listCalls++;
      return [...nodes.values()].filter(node => node.parent === uri).map(node => node.entry);
    },
    async createDocument(_tree, parentUri, name, directory) { return add(parentUri, name, directory); },
    async deleteDocument(_tree, uri) {
      for (const key of [...nodes.keys()]) if (key === uri || key.startsWith(`${uri}/`)) nodes.delete(key);
    },
    async openWriter(_tree, uri) {
      const id = nextWriter++;
      writers.set(id, { uri, parts: [] });
      return id;
    },
    async writeChunk(id, bytes) {
      chunkSizes.push(bytes.byteLength);
      writers.get(id)!.parts.push(bytes.slice());
    },
    async closeWriter(id) {
      const writer = writers.get(id)!;
      const total = writer.parts.reduce((sum, part) => sum + part.byteLength, 0);
      const data = new Uint8Array(total);
      let offset = 0;
      for (const part of writer.parts) { data.set(part, offset); offset += part.byteLength; }
      nodes.get(writer.uri)!.data = data;
      writers.delete(id);
    },
    async abortWriter(id) { writers.delete(id); },
    async readFile(uri) { return new Blob([nodes.get(uri)!.data]); },
  };

  const root = add(null, 'root', true);
  add('root', 'a.json', false, '{"a":1}');
  add('root', 'media', true);
  add('root/media', 'p.jpg', false, 'jpg');
  return { native, nodes, writers, chunkSizes, root, listCalls: () => listCalls };
}

async function names(dir: SafDirectoryHandle): Promise<string[]> {
  const result: string[] = [];
  for await (const [name] of dir.entries()) result.push(name);
  return result.sort();
}

describe('SafDirectoryHandle', () => {
  it('lists children once and reuses the cache', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    expect(await names(dir)).toEqual(['a.json', 'media']);
    expect(await names(dir)).toEqual(['a.json', 'media']);
    expect(fake.listCalls()).toBe(1);
  });

  it('returns typed child handles', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    const kinds: Record<string, string> = {};
    for await (const [name, handle] of dir.entries()) kinds[name] = handle.kind;
    expect(kinds).toEqual({ 'a.json': 'file', media: 'directory' });
    const media = await dir.getDirectoryHandle('media');
    expect(await names(media)).toEqual(['p.jpg']);
  });

  it('reads a file as a File with name and bytes', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    const file = await (await dir.getFileHandle('a.json')).getFile();
    expect(file.name).toBe('a.json');
    expect(file.type).toBe('application/json');
    expect(await file.text()).toBe('{"a":1}');
  });

  it('rejects missing names and kind mismatches', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await expect(dir.getFileHandle('missing.json')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(dir.getDirectoryHandle('a.json')).rejects.toMatchObject({ name: 'TypeMismatchError' });
    await expect(dir.getFileHandle('media')).rejects.toMatchObject({ name: 'TypeMismatchError' });
    await expect(dir.getFileHandle('../x')).rejects.toBeInstanceOf(TypeError);
  });

  it('creates a file and refreshes the listing', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await names(dir);
    const created = await dir.getFileHandle('new.overlay.json', { create: true });
    expect(created.name).toBe('new.overlay.json');
    expect(await names(dir)).toEqual(['a.json', 'media', 'new.overlay.json']);
  });

  it('refuses to remove a non-empty directory without recursive', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await expect(dir.removeEntry('media')).rejects.toMatchObject({ name: 'InvalidModificationError' });
    await dir.removeEntry('media', { recursive: true });
    expect(await names(dir)).toEqual(['a.json']);
    expect(fake.nodes.has('root/media/p.jpg')).toBe(false);
  });

  it('reports granted permissions', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    await expect(dir.queryPermission()).resolves.toBe('granted');
    await expect(dir.requestPermission()).resolves.toBe('granted');
  });
});

describe('SafWritable', () => {
  it('writes text and replaces the file on close', async () => {
    const fake = makeFake();
    const dir = new SafDirectoryHandle(fake.native, 'tree', fake.root);
    const writable = await (await dir.getFileHandle('a.json')).createWritable();
    await writable.write('{"b":2}');
    await writable.close();
    expect(new TextDecoder().decode(fake.nodes.get('root/a.json')!.data)).toBe('{"b":2}');
  });

  it('splits large buffers and blobs into 1 MB chunks', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    const writable = new SafWritable(fake.native, writerId, () => {});
    await writable.write(new Uint8Array(SAF_CHUNK_BYTES * 2 + 5));
    await writable.write(new Blob([new Uint8Array(SAF_CHUNK_BYTES + 1)]));
    await writable.close();
    expect(fake.chunkSizes).toEqual([SAF_CHUNK_BYTES, SAF_CHUNK_BYTES, 5, SAF_CHUNK_BYTES, 1]);
    expect(fake.nodes.get('root/a.json')!.data.byteLength).toBe(SAF_CHUNK_BYTES * 3 + 6);
  });

  it('accepts the write-command object form', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    const writable = new SafWritable(fake.native, writerId, () => {});
    await writable.write({ type: 'write', data: 'xy' });
    await writable.close();
    expect(new TextDecoder().decode(fake.nodes.get('root/a.json')!.data)).toBe('xy');
  });

  it('rejects writes after close and calls onClosed once', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    let closed = 0;
    const writable = new SafWritable(fake.native, writerId, () => { closed++; });
    await writable.close();
    await expect(writable.write('late')).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(closed).toBe(1);
  });

  it('aborts without replacing the file', async () => {
    const fake = makeFake();
    const writerId = await fake.native.openWriter('tree', 'root/a.json');
    const writable = new SafWritable(fake.native, writerId, () => {});
    await writable.write('partial');
    await writable.abort();
    expect(fake.writers.size).toBe(0);
    expect(new TextDecoder().decode(fake.nodes.get('root/a.json')!.data)).toBe('{"a":1}');
  });
});
