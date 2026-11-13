import { createContext, useContext } from 'react';

/**
 * Stable callbacks for per-message actions. The object never changes, so
 * memoized bubbles do not re-render when overlay or selection state changes.
 */
export interface MessageActions {
  toggleFavorite: (index: number) => void;
  deleteMessage: (index: number) => void;
  startSelection: (index: number) => void;
  toggleSelected: (index: number, range: boolean) => void;
}

const noop = () => {};

export const MessageActionsContext = createContext<MessageActions>({
  toggleFavorite: noop,
  deleteMessage: noop,
  startSelection: noop,
  toggleSelected: noop,
});

export function useMessageActions(): MessageActions {
  return useContext(MessageActionsContext);
}

export function getAvatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** A stable hue per sender so avatars are distinguishable in group chats. */
export function getAvatarHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
