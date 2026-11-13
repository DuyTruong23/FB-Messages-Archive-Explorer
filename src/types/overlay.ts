export interface OverlayFavorite {
  id: string;
  addedAt: number;
  note: string;
}

export interface OverlaySettings {
  /** Participant whose messages render on the right. */
  me?: string;
}

/** User edits stored beside a conversation file; the conversation is never rewritten. */
export interface Overlay {
  version: 1;
  sourceFile: string;
  deleted: string[];
  favorites: OverlayFavorite[];
  settings?: OverlaySettings;
  updatedAt: number;
}

export interface SearchFilter {
  /** Empty means every sender. */
  senders: string[];
  /** Inclusive bounds in epoch milliseconds. */
  from: number | null;
  to: number | null;
  /** Ignore diacritics and Vietnamese "đ" when matching. */
  normalize: boolean;
  hasMedia: boolean;
  hasLink: boolean;
  favoritesOnly: boolean;
}

export type OverlayPersistence = 'file' | 'indexeddb' | 'memory';
