import React, { useEffect, useRef } from 'react';
import {
  getEnteringKingReasonMessage,
  type EnteringKingEvaluation,
} from '../../domain/shogi';

interface EnteringKingDeclarationDialogProps {
  evaluation: EnteringKingEvaluation;
  onConfirm: () => void;
  onCancel: () => void;
}

function conditionLabel(isSatisfied: boolean): string {
  return isSatisfied ? '満たしています' : '満たしていません';
}

export const EnteringKingDeclarationDialog: React.FC<
  EnteringKingDeclarationDialogProps
> = ({ evaluation, onConfirm, onCancel }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const declarerName = evaluation.declarer === 'sente' ? '先手' : '後手';
  const outcomeLabel =
    evaluation.outcome === 'win'
      ? '宣言勝ち'
      : evaluation.outcome === 'draw'
        ? '無勝負'
        : '宣言条件不足';

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
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="entering-king-dialog-title"
        aria-describedby="entering-king-dialog-description entering-king-dialog-result"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-md border border-amber-600/60 bg-[#211811] p-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.78),inset_0_1px_rgba(255,255,255,0.05)] sm:p-5"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-px w-28 bg-gradient-to-r from-transparent via-amber-400/80 to-transparent"
        />
        <h2
          id="entering-king-dialog-title"
          className="text-center font-serif text-xl font-semibold tracking-[0.12em] text-amber-100"
        >
          入玉宣言を確認
        </h2>
        <p
          id="entering-king-dialog-description"
          className="mt-2 text-center text-sm leading-6 text-stone-300"
        >
          宣言者は{declarerName}です。現在局面の公式条件を確認してください。
        </p>

        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded border border-amber-900/50 bg-black/20 p-3 text-sm">
          <dt className="text-stone-300">玉が敵陣3段目以内</dt>
          <dd className={evaluation.isKingInEnemyCamp ? 'text-emerald-300' : 'text-rose-300'}>
            {conditionLabel(evaluation.isKingInEnemyCamp)}
          </dd>
          <dt className="text-stone-300">玉が王手を受けていない</dt>
          <dd className={evaluation.isKingNotInCheck ? 'text-emerald-300' : 'text-rose-300'}>
            {conditionLabel(evaluation.isKingNotInCheck)}
          </dd>
          <dt className="text-stone-300">敵陣内の自駒（玉を除く）</dt>
          <dd className={evaluation.campPieceCount >= evaluation.requiredCampPieceCount ? 'text-emerald-300' : 'text-rose-300'}>
            {evaluation.campPieceCount}枚 / 必要{evaluation.requiredCampPieceCount}枚
          </dd>
          <dt className="text-stone-300">宣言対象点数</dt>
          <dd className={evaluation.points >= 24 ? 'text-emerald-300' : 'text-rose-300'}>
            {evaluation.points}点
          </dd>
          <dt className="text-stone-300">完了手数</dt>
          <dd className={evaluation.isBeforeMoveLimit ? 'text-emerald-300' : 'text-rose-300'}>
            {evaluation.completedMoves}手（500手未満）
          </dd>
        </dl>

        <p
          id="entering-king-dialog-result"
          className={`mt-4 text-center font-serif text-lg font-semibold ${
            evaluation.outcome === 'ineligible' ? 'text-rose-300' : 'text-amber-200'
          }`}
        >
          判定：{outcomeLabel}
        </p>

        {evaluation.reasons.length > 0 && (
          <div className="mt-3 rounded border border-rose-900/60 bg-rose-950/30 p-3">
            <p className="text-sm font-semibold text-rose-200">満たしていない条件</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-rose-100">
              {evaluation.reasons.map((reason) => (
                <li key={reason}>{getEnteringKingReasonMessage(reason)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={evaluation.outcome === 'ineligible'}
            className="min-w-28 rounded border border-amber-600/70 bg-amber-900/55 px-4 py-2 font-serif text-amber-50 outline-none transition hover:bg-amber-800/70 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-stone-900/60 disabled:text-stone-500"
          >
            宣言する
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="min-w-24 rounded border border-stone-600/70 bg-stone-800/70 px-4 py-2 font-serif text-stone-100 outline-none transition hover:bg-stone-700/80 focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};
