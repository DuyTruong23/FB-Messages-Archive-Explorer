import type { MessengerMessage } from '../types/messenger';

type IdentifiableMessage = Pick<MessengerMessage, 'timestamp_ms' | 'timestamp' | 'senderName' | 'sender_name' | '_sourceIndex'>;

/** cyrb53: a fast 53-bit string hash; enough to separate messages in one file. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Stable id of a message: its timestamp, sender and position in the source
 * file. `index` is used only when the loader did not record `_sourceIndex`.
 */
export function getMessageId(msg: IdentifiableMessage, index: number): string {
  const timestamp = Number(msg.timestamp_ms ?? msg.timestamp ?? 0);
  const sender = msg.senderName || msg.sender_name || '';
  const sourceIndex = msg._sourceIndex ?? index;
  return hash53(`${Number.isFinite(timestamp) ? timestamp : 0}\u0000${sender}\u0000${sourceIndex}`);
}

export function getMessageIds(messages: readonly IdentifiableMessage[]): string[] {
  return messages.map(getMessageId);
}
