import React, { useEffect, useRef } from 'react';
import type { Player } from '../../types/shogi';

interface ResignationDialogProps {
  resigningPlayer: Player;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ResignationDialog: React.FC<ResignationDialogProps> = ({
  resigningPlayer,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const resigningPlayerName = resigningPlayer === 'sente' ? '先手' : '後手';
  const winnerName = resigningPlayer === 'sente' ? '後手' : '先手';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resignation-dialog-title"
        aria-describedby="resignation-dialog-description"
        onKeyDown={handleKeyDown}
        className="w-full max-w-sm rounded-md border border-amber-700/60 bg-[#211811] p-5 text-center shadow-[0_24px_80px_rgba(0,0,0,0.78),inset_0_1px_rgba(255,255,255,0.05)]"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-px w-24 bg-gradient-to-r from-transparent via-rose-500/70 to-transparent"
        />
        <h2
          id="resignation-dialog-title"
          className="font-serif text-xl font-semibold tracking-[0.14em] text-amber-100"
        >
          投了しますか？
        </h2>
        <p
          id="resignation-dialog-description"
          className="mt-2 text-sm leading-6 text-stone-300"
        >
          {resigningPlayerName}が投了すると、{winnerName}の勝ちで対局を終了します。
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="min-w-24 rounded border border-rose-700/70 bg-rose-950/70 px-4 py-2 font-serif text-rose-100 outline-none transition hover:bg-rose-900/80 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            投了する
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
