import type { ChatListEntry } from '../../types/messenger';
import { getOrderedMessageFileNames } from '../parser';
import { mapWithConcurrency, FILE_READ_CONCURRENCY } from '../concurrency';
import type { WideSearchChatKind } from './wideSearchCore';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export function getWideSearchChatKind(entry: ChatListEntry): WideSearchChatKind {
  return entry._messengerExport ? 'messenger-export' : 'facebook';
}

export function getWideSearchChatKey(entry: ChatListEntry, hideNotices: boolean): string {
  const hide = hideNotices && !entry._messengerExport;
  return [entry.source, entry.dirHandle.name, entry.folderName, entry._jsonFileName || '', hide].join('\u0000');
}

/** Snapshot the files a chat's index is built from, in the chat loader's order. */
export async function collectChatSearchFiles(entry: ChatListEntry, signal?: AbortSignal): Promise<File[]> {
  throwIfAborted(signal);
  if (entry._messengerExport) {
    const handle = await entry.dirHandle.getFileHandle(entry._jsonFileName!);
    throwIfAborted(signal);
    return [await handle.getFile()];
  }

  const names: string[] = [];
  for await (const [name, handle] of entry.dirHandle.entries()) {
    throwIfAborted(signal);
    if (handle.kind === 'file') names.push(name);
  }
  const ordered = getOrderedMessageFileNames(names);
  const files = await mapWithConcurrency(ordered, FILE_READ_CONCURRENCY, async name => {
    try {
      return await (await entry.dirHandle.getFileHandle(name)).getFile();
    } catch {
      throwIfAborted(signal);
      return null;
    }
  }, signal);
  const readable = files.filter((file): file is File => file !== null);
  if (!readable.length) throw new Error('No readable message files found in this chat folder.');
  return readable;
}
