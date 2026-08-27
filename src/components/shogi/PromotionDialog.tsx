import React, { useEffect, useRef } from 'react';
import { PromotionStatus } from '../../domain/shogi';

interface PromotionDialogProps {
  status: Exclude<PromotionStatus, 'none'>;
  onPromote: () => void;
  onDecline: () => void;
  onCancel: () => void;
}

export const PromotionDialog: React.FC<PromotionDialogProps> = ({
  status,
  onPromote,
  onDecline,
  onCancel,
}) => {
  const promoteButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    promoteButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const isRequired = status === 'required';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promotion-dialog-title"
        aria-describedby="promotion-dialog-description"
        className="w-full max-w-sm rounded-md border border-amber-700/60 bg-[#211811] p-5 text-center shadow-[0_24px_80px_rgba(0,0,0,0.75),inset_0_1px_rgba(255,255,255,0.05)]"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-px w-24 bg-gradient-to-r from-transparent via-amber-500/70 to-transparent" />
        <h2
          id="promotion-dialog-title"
          className="font-serif text-xl font-semibold tracking-[0.18em] text-amber-100"
        >
          成り選択
        </h2>
        <p id="promotion-dialog-description" className="mt-2 text-sm leading-6 text-stone-300">
          {isRequired ? 'この手は成りが必須です。' : 'この駒を成りますか？'}
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            ref={promoteButtonRef}
            type="button"
            onClick={onPromote}
            className="min-w-20 rounded border border-amber-500/70 bg-amber-800/60 px-4 py-2 font-serif text-amber-50 outline-none transition hover:bg-amber-700/70 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            成る
          </button>
          {!isRequired && (
            <button
              type="button"
              onClick={onDecline}
              className="min-w-20 rounded border border-stone-500/70 bg-stone-800 px-4 py-2 font-serif text-stone-100 outline-none transition hover:bg-stone-700 focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              不成
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="min-w-20 rounded border border-stone-700 bg-transparent px-4 py-2 text-sm text-stone-300 outline-none transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};
