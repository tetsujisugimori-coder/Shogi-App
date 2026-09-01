import React, { useLayoutEffect, useRef, useState } from 'react';
import type { GameResult, MoveRecord } from '../../types/shogi';
import { getGameResultDisplay } from './gameResultDisplay';

export interface MoveHistoryPanelProps {
  history: readonly MoveRecord[];
  result: GameResult | null | undefined;
  resetKey?: number;
}

const PANEL_ID = 'shogi-move-history-panel';

export const MoveHistoryPanel: React.FC<MoveHistoryPanelProps> = ({
  history,
  result,
  resetKey = 0,
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousResetKeyRef = useRef(resetKey);
  const hasResult = Boolean(result);
  const resultDisplay = result ? getGameResultDisplay(result) : null;

  useLayoutEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = 0;
    }
    setIsMobileOpen(false);
  }, [resetKey]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = history.length === 0 && !hasResult ? 0 : container.scrollHeight;
    }
  }, [history.length, hasResult, isMobileOpen]);

  return (
    <aside
      className="w-full min-w-0 xl:w-72 xl:flex-none"
      aria-label="棋譜パネル"
    >
      <button
        type="button"
        className="mb-3 w-full rounded-lg border border-amber-800/70 bg-stone-950/80 px-4 py-2 font-serif text-sm tracking-[0.12em] text-amber-100 shadow-inner outline-none transition hover:border-amber-600 hover:bg-amber-950/60 focus-visible:ring-2 focus-visible:ring-amber-300 md:hidden"
        aria-expanded={isMobileOpen}
        aria-controls={PANEL_ID}
        onClick={() => setIsMobileOpen((current) => !current)}
      >
        {isMobileOpen ? '棋譜を閉じる' : '棋譜を表示'}
      </button>

      <section
        id={PANEL_ID}
        aria-labelledby="shogi-move-history-heading"
        className={`${isMobileOpen ? 'block' : 'hidden'} min-w-0 overflow-hidden rounded-2xl border border-amber-900/45 bg-gradient-to-b from-[#1d1712] to-[#100e0c] shadow-[0_20px_45px_-24px_rgba(0,0,0,0.95)] md:block`}
      >
        <div className="border-b border-amber-900/40 px-4 py-3">
          <h2
            id="shogi-move-history-heading"
            className="font-serif text-lg font-bold tracking-[0.18em] text-amber-100"
          >
            棋譜
          </h2>
          <p className="mt-0.5 text-xs text-stone-500">対局中の着手履歴</p>
        </div>

        <div
          ref={scrollContainerRef}
          data-testid="move-history-scroll-container"
          className="max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 md:max-h-[34rem]"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="着手履歴"
        >
          {history.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-stone-400">
              まだ着手はありません
            </p>
          ) : (
            <ol className="m-0 list-none space-y-1 p-0">
              {history.map((move, index) => {
                const isLatest = index === history.length - 1;
                return (
                  <li
                    key={`${move.moveNumber}-${index}`}
                    aria-current={isLatest ? 'step' : undefined}
                    aria-label={`${move.moveNumber}手目 ${move.notation}${isLatest ? ' 最新手' : ''}`}
                    className={`grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border-l-2 px-2 py-2 font-serif text-sm ${
                      isLatest
                        ? 'border-amber-400 bg-amber-900/35 text-amber-100'
                        : 'border-transparent text-stone-300'
                    }`}
                  >
                    <span className="text-right tabular-nums text-stone-500" aria-hidden="true">
                      {move.moveNumber}
                    </span>
                    <span className="min-w-0 truncate" aria-hidden="true">
                      {move.notation}
                    </span>
                    {isLatest && (
                      <span
                        className="rounded border border-amber-700/60 bg-amber-950/70 px-1.5 py-0.5 text-[0.65rem] font-sans tracking-wide text-amber-300"
                        aria-hidden="true"
                      >
                        最新
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {resultDisplay && (
            <section
              className="mt-4 border-t border-amber-800/50 px-2 pt-4"
              aria-labelledby="shogi-game-result-heading"
            >
              <h3
                id="shogi-game-result-heading"
                className="text-xs font-semibold tracking-[0.14em] text-stone-400"
              >
                対局結果
              </h3>
              <p className="mt-2 rounded-md border border-stone-700/70 bg-stone-950/70 px-3 py-2 text-sm leading-relaxed text-stone-200">
                {resultDisplay.panelText}
              </p>
            </section>
          )}
        </div>
      </section>
    </aside>
  );
};
