import React, { useState } from 'react';
import { createInitialBoardState, BoardState } from '../../types/shogi';
import { ShogiTable } from './ShogiTable';

export const ShogiResearchScreen: React.FC = () => {
  const [boardState] = useState<BoardState>(() => createInitialBoardState());

  return (
    <div
      id="shogi-research-screen"
      className="min-h-full w-full flex flex-col items-center justify-between py-6 px-3 sm:px-6 bg-[#0f1115] text-stone-200"
    >
      {/* Top Header Section */}
      <header className="w-full max-w-4xl flex flex-col items-center text-center gap-2 mb-6">
        <div className="flex items-center gap-3">
          <h1
            id="shogi-screen-title"
            className="text-2xl sm:text-3xl font-serif font-bold text-amber-100 tracking-wider"
            style={{
              fontFamily:
                '"Yu Mincho", "Hiragino Mincho ProN", "YuMincho", "MS PMincho", "Noto Serif JP", serif',
            }}
          >
            将棋研究
          </h1>
          <span
            id="shogi-status-badge"
            className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-medium bg-amber-950/70 text-amber-300 border border-amber-800/50 shadow-inner"
            role="status"
            aria-live="polite"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            準備中 / 先手番
          </span>
        </div>

        <p
          id="shogi-screen-description"
          className="text-xs sm:text-sm text-stone-400 font-sans tracking-wide max-w-xl"
        >
          AIとの対局・棋譜・判断ログを記録する研究画面です。
        </p>
      </header>

      {/* Main Table Section */}
      <main className="w-full flex-1 flex flex-col items-center justify-center">
        <ShogiTable
          squares={boardState.squares}
          senteHand={boardState.senteHand}
          goteHand={boardState.goteHand}
          status={boardState.status}
          viewMode={boardState.viewMode}
        />
      </main>

      {/* Bottom Footer Notice */}
      <footer className="w-full max-w-4xl mt-8 pt-4 border-t border-stone-800/60 text-center">
        <p
          id="shogi-footer-notice"
          className="text-xs text-stone-400 font-sans tracking-wide select-none"
        >
          盤面表示の初期実装です。駒移動・対局機能は準備中です。
        </p>
      </footer>
    </div>
  );
};
