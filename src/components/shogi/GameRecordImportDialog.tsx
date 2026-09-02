import React, { useEffect, useRef } from 'react';

interface GameRecordImportDialogProps {
  filename: string;
  exportedAt: string;
  moveCount: number;
  isEnded: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const GameRecordImportDialog: React.FC<GameRecordImportDialogProps> = ({
  filename,
  exportedAt,
  moveCount,
  isEnded,
  onConfirm,
  onCancel,
}) => {
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
    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
    );
    if (buttons.length === 0) return;
    const firstButton = buttons[0];
    const lastButton = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      firstButton.focus();
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
        aria-labelledby="game-record-import-dialog-title"
        aria-describedby="game-record-import-dialog-description game-record-import-dialog-details"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-md border border-violet-600/60 bg-[#191522] p-4 text-center shadow-[0_24px_80px_rgba(0,0,0,0.78),inset_0_1px_rgba(255,255,255,0.05)] sm:p-5"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-px w-28 bg-gradient-to-r from-transparent via-violet-400/80 to-transparent"
        />
        <h2
          id="game-record-import-dialog-title"
          className="font-serif text-xl font-semibold tracking-[0.08em] text-violet-100"
        >
          この対局記録を読み込みますか？
        </h2>
        <p
          id="game-record-import-dialog-description"
          className="mt-2 text-sm leading-6 text-stone-300"
        >
          現在の対局は、検証済みの対局記録で置き換えられます。
        </p>
        <dl
          id="game-record-import-dialog-details"
          className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 rounded border border-stone-700/70 bg-black/20 p-3 text-left text-sm"
        >
          <dt className="text-stone-400">ファイル</dt>
          <dd className="min-w-0 break-words text-stone-100">{filename}</dd>
          <dt className="text-stone-400">書き出し日時</dt>
          <dd className="min-w-0 break-words text-stone-100">
            <time dateTime={exportedAt}>{exportedAt}</time>
          </dd>
          <dt className="text-stone-400">着手数</dt>
          <dd className="text-stone-100">{moveCount}手</dd>
          <dt className="text-stone-400">状態</dt>
          <dd className="text-stone-100">{isEnded ? '終局済み' : '未終局（続行可能）'}</dd>
        </dl>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="min-w-24 rounded border border-stone-600 bg-stone-900/75 px-4 py-2 font-serif text-stone-100 outline-none transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-w-28 rounded border border-violet-600/70 bg-violet-950/70 px-4 py-2 font-serif text-violet-100 outline-none transition hover:bg-violet-900/80 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            読み込む
          </button>
        </div>
      </div>
    </div>
  );
};
