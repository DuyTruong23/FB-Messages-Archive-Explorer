import { describe, expect, it } from 'vitest';
import { getMessageId, getMessageIds } from '../src/services/messageId';
import { parseMessengerExportJson } from '../src/services/messengerExport/messengerExportParser';

describe('getMessageId', () => {
  const message = { senderName: 'Quoc Duy', sender_name: 'Quoc Duy', timestamp_ms: 1760199384846 };

  it('is deterministic and a 14-digit hex string', () => {
    const id = getMessageId(message, 3);
    expect(id).toMatch(/^[0-9a-f]{14}$/);
    expect(getMessageId({ ...message }, 3)).toBe(id);
  });

  it('changes with timestamp, sender or index', () => {
    const id = getMessageId(message, 3);
    expect(getMessageId({ ...message, timestamp_ms: 1760199384847 }, 3)).not.toBe(id);
    expect(getMessageId({ ...message, senderName: 'Thanh Dii' }, 3)).not.toBe(id);
    expect(getMessageId(message, 4)).not.toBe(id);
  });

  it('prefers the recorded source index over the display index', () => {
    expect(getMessageId({ ...message, _sourceIndex: 7 }, 0)).toBe(getMessageId(message, 7));
  });

  it('separates identical messages sent in the same millisecond', () => {
    const ids = getMessageIds([message, message, message]);
    expect(new Set(ids).size).toBe(3);
  });

  it('has no collisions across 50,000 messages', () => {
    const messages = Array.from({ length: 50_000 }, (_, index) => ({
      senderName: index % 2 ? 'Quoc Duy' : 'Thanh Dii',
      timestamp_ms: 1760000000000 + Math.floor(index / 3) * 1000,
    }));
    expect(new Set(getMessageIds(messages)).size).toBe(messages.length);
  });

  it('survives the timestamp sort done by the parser', () => {
    const thread = parseMessengerExportJson(JSON.stringify({
      threadName: 'Thanh Dii',
      participants: ['Quoc Duy', 'Thanh Dii'],
      messages: [
        { senderName: 'Quoc Duy', text: 'newest', timestamp: 300, type: 'text' },
        { senderName: 'Thanh Dii', text: 'oldest', timestamp: 100, type: 'text' },
        { senderName: 'Quoc Duy', text: 'middle', timestamp: 200, type: 'text' },
      ],
    }));
    expect(thread.messages.map(message => message.text)).toEqual(['oldest', 'middle', 'newest']);
    expect(thread.messages.map(message => message._sourceIndex)).toEqual([1, 2, 0]);
    expect(getMessageIds(thread.messages)).toEqual([
      getMessageId({ senderName: 'Thanh Dii', timestamp_ms: 100 }, 1),
      getMessageId({ senderName: 'Quoc Duy', timestamp_ms: 200 }, 2),
      getMessageId({ senderName: 'Quoc Duy', timestamp_ms: 300 }, 0),
    ]);
  });
});
