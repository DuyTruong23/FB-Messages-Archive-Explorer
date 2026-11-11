import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface MessageSelection {
  active: boolean;
  selected: ReadonlySet<number>;
  /** Enter checkbox mode, optionally selecting one message. */
  start: (index?: number) => void;
  stop: () => void;
  /**
   * Toggle one message. With `range`, select every selectable message between
   * the previously toggled message and this one (Shift+click).
   */
  toggle: (index: number, range?: boolean, isSelectable?: (index: number) => boolean) => void;
}

const EMPTY = new Set<number>();
const noop = () => {};
const DISABLED: MessageSelection = { active: false, selected: EMPTY, start: noop, stop: noop, toggle: noop };

export const MessageSelectionContext = createContext<MessageSelection>(DISABLED);

export function useMessageSelectionContext(): MessageSelection {
  return useContext(MessageSelectionContext);
}

export function selectRange(
  selected: ReadonlySet<number>,
  anchor: number,
  index: number,
  isSelectable: (index: number) => boolean = () => true
): Set<number> {
  const next = new Set(selected);
  const start = Math.min(anchor, index);
  const end = Math.max(anchor, index);
  for (let i = start; i <= end; i++) if (isSelectable(i)) next.add(i);
  return next;
}

/** Selection is cleared whenever `resetKey` (the open conversation) changes. */
export function useMessageSelection(resetKey: unknown): MessageSelection {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(EMPTY);
  const anchorRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    setActive(false);
    setSelected(EMPTY);
    anchorRef.current = null;
  }, []);

  useEffect(stop, [resetKey, stop]);

  const start = useCallback((index?: number) => {
    setActive(true);
    if (index === undefined) return;
    anchorRef.current = index;
    setSelected(previous => new Set(previous).add(index));
  }, []);

  const toggle = useCallback((index: number, range = false, isSelectable?: (index: number) => boolean) => {
    const anchor = anchorRef.current;
    anchorRef.current = index;
    setActive(true);
    setSelected(previous => {
      if (range && anchor !== null && anchor !== index) return selectRange(previous, anchor, index, isSelectable);
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  return useMemo(() => ({ active, selected, start, stop, toggle }), [active, selected, start, stop, toggle]);
}
