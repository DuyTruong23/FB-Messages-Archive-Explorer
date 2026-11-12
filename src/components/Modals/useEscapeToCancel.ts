import { useEffect, useRef } from 'react';

/** Cancels a confirmation modal on Escape, which Android system Back also sends. */
export function useEscapeToCancel(onCancel: () => void, disabled = false) {
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel.current(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [disabled]);
}
