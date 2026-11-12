// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnableDeletionModal } from '../src/components/Modals/EnableDeletionModal';
import { useEscapeToCancel } from '../src/components/Modals/useEscapeToCancel';

afterEach(cleanup);

function Probe({ onCancel, disabled }: { onCancel: () => void; disabled?: boolean }) {
  useEscapeToCancel(onCancel, disabled);
  return null;
}

describe('modal Escape', () => {
  it('cancels the enable-deletion confirmation on Escape', () => {
    const onCancel = vi.fn();
    render(<EnableDeletionModal onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('ignores Escape while the modal is busy and other keys', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<Probe onCancel={onCancel} disabled />);
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<Probe onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
