import type { MessengerMessage } from '../types/messenger';
import { fixEncoding } from './parser';
import { getMessageBump } from './messageBump';
import { getMessageLinks } from './messageLinks';
import { FAILED_MEDIA_LABEL } from './search';

/** One-line description of a message for lists such as Favorites and Deleted. */
export function describeMessage(msg: MessengerMessage): string {
  if (msg.is_unsent) return 'Tin nhắn đã bị thu hồi';
  const text = fixEncoding(msg.text || msg.content || '').trim();
  if (text) return text;
  const bump = getMessageBump(msg);
  if (bump) return bump.text || bump.label;
  const media = [msg.photos, msg.videos, msg.gifs, msg.audio, msg.audio_files, msg.files]
    .reduce((count, items) => count + (items?.length || 0), 0);
  if (media > 0) return media === 1 ? '[1 tệp đính kèm]' : `[${media} tệp đính kèm]`;
  if (msg.failedMediaCount) return `⚠ ${FAILED_MEDIA_LABEL}`;
  if (msg.sticker) return '[Sticker]';
  const link = getMessageLinks(msg)[0];
  if (link) return link.label || link.url;
  return `[${msg.type || 'Tin nhắn'}]`;
}
