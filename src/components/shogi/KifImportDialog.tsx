import React, { useEffect, useRef } from 'react';

interface KifImportDialogProps {
  filename: string;
  moveCount: number;
  isEnded: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation UI intentionally mirrors JSON record import, while clearly naming KIF. */
export const KifImportDialog: React.FC<KifImportDialogProps> = ({
  filename,
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
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
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
        aria-labelledby="kif-import-dialog-title"
        aria-describedby="kif-import-dialog-description kif-import-dialog-details"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-md border border-amber-500/60 bg-[#1b1710] p-4 text-center shadow-[0_24px_80px_rgba(0,0,0,0.78),inset_0_1px_rgba(255,255,255,0.05)] sm:p-5"
      >
        <h2 id="kif-import-dialog-title" className="font-serif text-xl font-semibold tracking-[0.08em] text-amber-100">
          このKIF棋譜を読み込みますか？
        </h2>
        <p id="kif-import-dialog-description" className="mt-2 text-sm leading-6 text-stone-300">
          現在の対局は、平手初期局面から検証済みの棋譜で置き換えられます。
        </p>
        <dl id="kif-import-dialog-details" className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 rounded border border-stone-700/70 bg-black/20 p-3 text-left text-sm">
          <dt className="text-stone-400">ファイル</dt>
          <dd className="min-w-0 break-words text-stone-100">{filename}</dd>
          <dt className="text-stone-400">着手数</dt>
          <dd className="text-stone-100">{moveCount}手</dd>
          <dt className="text-stone-400">状態</dt>
          <dd className="text-stone-100">{isEnded ? '終局済み' : '未終局（続行可能）'}</dd>
        </dl>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} className="min-w-24 rounded border border-stone-600 bg-stone-900/75 px-4 py-2 font-serif text-stone-100 outline-none transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-amber-300">
            キャンセル
          </button>
          <button type="button" onClick={onConfirm} className="min-w-28 rounded border border-amber-500/70 bg-amber-950/70 px-4 py-2 font-serif text-amber-100 outline-none transition hover:bg-amber-900/80 focus-visible:ring-2 focus-visible:ring-amber-300">
            読み込む
          </button>
        </div>
      </div>
    </div>
  );
};
