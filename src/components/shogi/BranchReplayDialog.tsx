import React, { useEffect, useRef } from 'react';

interface BranchReplayDialogProps {
  kind: 'start' | 'return';
  historyIndex?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const BranchReplayDialog: React.FC<BranchReplayDialogProps> = ({
  kind,
  historyIndex,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isStart = kind === 'start';
  const positionLabel = historyIndex === 0 ? '初期局面' : `第${historyIndex}手後の局面`;

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
    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
    );
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]"
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
        aria-labelledby="branch-replay-dialog-title"
        aria-describedby="branch-replay-dialog-description"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-md border border-amber-700/60 bg-[#211811] p-5 text-center shadow-[0_24px_80px_rgba(0,0,0,0.78),inset_0_1px_rgba(255,255,255,0.05)]"
      >
        <h2 id="branch-replay-dialog-title" className="font-serif text-xl font-semibold tracking-[0.1em] text-amber-100">
          {isStart ? 'ここから指し直しますか？' : '本譜へ戻りますか？'}
        </h2>
        <p id="branch-replay-dialog-description" className="mt-2 text-sm leading-6 text-stone-300">
          {isStart
            ? `${positionLabel}から指し直します。本譜は変更されません。`
            : '現在の検討手順はこのセッション内に保持したまま、本譜の現在局面へ切り替えます。'}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className="min-w-32 rounded border border-sky-700/70 bg-sky-950/70 px-4 py-2 font-serif text-sky-100 outline-none transition hover:bg-sky-900/80 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            {isStart ? 'ここから指し直す' : '本譜へ戻る'}
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
