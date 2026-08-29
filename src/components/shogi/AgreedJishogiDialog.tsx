import React, { useEffect, useRef } from 'react';
import {
  getAgreedJishogiReasonMessage,
  type AgreedJishogiEvaluation,
  type AgreedJishogiProposal,
} from '../../domain/shogi';

interface AgreedJishogiDialogProps {
  evaluation: AgreedJishogiEvaluation;
  proposal: AgreedJishogiProposal | null;
  errorMessage: string | null;
  onPropose: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onReject: () => void;
}

function playerName(player: 'sente' | 'gote'): string {
  return player === 'sente' ? '先手' : '後手';
}

function plannedResultLabel(evaluation: AgreedJishogiEvaluation): string {
  if (evaluation.outcome.kind === 'draw') return '双方24点以上のため無勝負';
  if (evaluation.outcome.kind === 'point_loss') {
    return `${playerName(evaluation.outcome.winner)}勝ち・${playerName(evaluation.outcome.loser)}点数不足による負け`;
  }
  return '点数不足側を一意に判定できません';
}

export const AgreedJishogiDialog: React.FC<AgreedJishogiDialogProps> = ({
  evaluation,
  proposal,
  errorMessage,
  onPropose,
  onCancel,
  onAccept,
  onReject,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const safeButtonRef = useRef<HTMLButtonElement>(null);
  const isResponseStage = proposal !== null;
  const dismiss = isResponseStage ? onReject : onCancel;

  useEffect(() => {
    safeButtonRef.current?.focus();
  }, [isResponseStage]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
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
          dismiss();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agreed-jishogi-dialog-title"
        aria-describedby={`agreed-jishogi-dialog-description agreed-jishogi-dialog-result${errorMessage ? ' agreed-jishogi-dialog-error' : ''}`}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-md border border-sky-700/60 bg-[#151d22] p-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.78),inset_0_1px_rgba(255,255,255,0.05)] sm:p-5"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-px w-28 bg-gradient-to-r from-transparent via-sky-400/80 to-transparent" />
        <h2 id="agreed-jishogi-dialog-title" className="text-center font-serif text-xl font-semibold tracking-[0.1em] text-sky-100">
          {isResponseStage ? '持将棋の提案へ応答' : '持将棋の提案を確認'}
        </h2>
        <p id="agreed-jishogi-dialog-description" className="mt-2 text-center text-sm leading-6 text-stone-300">
          {isResponseStage
            ? `${playerName(evaluation.proposer)}からの提案です。応答者は${playerName(evaluation.responder)}です。`
            : `現在の手番側である${playerName(evaluation.proposer)}が提案者です。相手の合意後に点数判定します。`}
        </p>

        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded border border-sky-900/50 bg-black/20 p-3 text-sm">
          <dt className="text-stone-300">先手玉の入玉</dt>
          <dd className={evaluation.senteKingInEnemyCamp ? 'text-emerald-300' : 'text-stone-400'}>
            {evaluation.senteKingInEnemyCamp ? '入玉しています' : '入玉していません'}
          </dd>
          <dt className="text-stone-300">後手玉の入玉</dt>
          <dd className={evaluation.goteKingInEnemyCamp ? 'text-emerald-300' : 'text-stone-400'}>
            {evaluation.goteKingInEnemyCamp ? '入玉しています' : '入玉していません'}
          </dd>
          <dt className="text-stone-300">先手の全所有駒</dt>
          <dd className={evaluation.sentePoints >= 24 ? 'text-emerald-300' : 'text-rose-300'}>{evaluation.sentePoints}点</dd>
          <dt className="text-stone-300">後手の全所有駒</dt>
          <dd className={evaluation.gotePoints >= 24 ? 'text-emerald-300' : 'text-rose-300'}>{evaluation.gotePoints}点</dd>
        </dl>

        <p id="agreed-jishogi-dialog-result" className={`mt-4 text-center font-serif text-base font-semibold ${evaluation.canPropose ? 'text-sky-200' : 'text-rose-300'}`}>
          承諾時の予定結果：{plannedResultLabel(evaluation)}
        </p>

        {evaluation.reasons.length > 0 && (
          <div className="mt-3 rounded border border-rose-900/60 bg-rose-950/30 p-3">
            <p className="text-sm font-semibold text-rose-200">提案できない理由</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-rose-100">
              {evaluation.reasons.map((reason) => (
                <li key={reason}>{getAgreedJishogiReasonMessage(reason)}</li>
              ))}
            </ul>
          </div>
        )}

        {errorMessage && (
          <p
            id="agreed-jishogi-dialog-error"
            role="alert"
            className="mt-3 break-words rounded border border-rose-800/70 bg-rose-950/40 p-3 text-sm leading-6 text-rose-100"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {isResponseStage ? (
            <>
              <button type="button" onClick={onAccept} className="min-w-28 rounded border border-sky-600/70 bg-sky-950/70 px-4 py-2 font-serif text-sky-50 outline-none transition hover:bg-sky-900/80 focus-visible:ring-2 focus-visible:ring-amber-300">
                承諾する
              </button>
              <button ref={safeButtonRef} type="button" onClick={onReject} className="min-w-28 rounded border border-stone-600/70 bg-stone-800/80 px-4 py-2 font-serif text-stone-100 outline-none transition hover:bg-stone-700/90 focus-visible:ring-2 focus-visible:ring-amber-300">
                拒否する
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onPropose} disabled={!evaluation.canPropose} className="min-w-28 rounded border border-sky-600/70 bg-sky-950/70 px-4 py-2 font-serif text-sky-50 outline-none transition hover:bg-sky-900/80 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-stone-900/60 disabled:text-stone-500">
                提案する
              </button>
              <button ref={safeButtonRef} type="button" onClick={onCancel} className="min-w-28 rounded border border-stone-600/70 bg-stone-800/80 px-4 py-2 font-serif text-stone-100 outline-none transition hover:bg-stone-700/90 focus-visible:ring-2 focus-visible:ring-amber-300">
                キャンセル
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
