import React, { useEffect, useRef } from 'react';

interface NewGameDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export const NewGameDialog: React.FC<NewGameDialogProps> = ({ onConfirm, onCancel }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
    );
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 px-3 py-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-game-dialog-title"
        aria-describedby="new-game-dialog-description"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-md border border-amber-600/60 bg-[#211811] p-4 text-center shadow-[0_24px_80px_rgba(0,0,0,0.78),inset_0_1px_rgba(255,255,255,0.05)] sm:p-5"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-px w-28 bg-gradient-to-r from-transparent via-amber-400/80 to-transparent"
        />
        <h2
          id="new-game-dialog-title"
          className="font-serif text-xl font-semibold tracking-[0.1em] text-amber-100"
        >
          新しい対局を始めますか？
        </h2>
        <p
          id="new-game-dialog-description"
          className="mt-2 text-sm leading-6 text-stone-300"
        >
          現在の盤面、持ち駒、棋譜、反則履歴、対局結果は破棄され、元に戻せません。
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="min-w-40 rounded border border-rose-700/70 bg-rose-950/70 px-4 py-2 font-serif text-rose-100 outline-none transition hover:bg-rose-900/80 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            新しい対局を始める
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="min-w-24 rounded border border-amber-600/60 bg-amber-900/40 px-4 py-2 font-serif text-amber-50 outline-none transition hover:bg-amber-800/55 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};
