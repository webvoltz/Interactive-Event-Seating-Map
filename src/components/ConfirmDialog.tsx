import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  // The backdrop button already blocks mouse clicks on the app behind it,
  // but Tab navigation could still reach it (a real gap, not just a visual
  // one - screen-reader/keyboard users could otherwise select or clear
  // seats while this dialog is "modally" open). `inert` removes the app
  // root from both focus and hit-testing entirely, for as long as the
  // dialog is mounted.
  useEffect(() => {
    const appRoot = document.getElementById('root');
    appRoot?.setAttribute('inert', '');
    return () => {
      appRoot?.removeAttribute('inert');
    };
  }, []);

  // Rendered via a portal straight into <body> rather than in place: the
  // sidebar wrapper in App.tsx carries an active translate-x-* transform
  // (for its mobile slide-in/out), and a `transform` on any ancestor creates
  // a new containing block for `position: fixed` descendants - so without
  // the portal, "fixed inset-0" here would size itself to that sidebar box
  // instead of the actual viewport, confining the dialog to the left column.
  return createPortal(
    <div className="fixed inset-0 z-80 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-gray-900">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm text-gray-600">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
