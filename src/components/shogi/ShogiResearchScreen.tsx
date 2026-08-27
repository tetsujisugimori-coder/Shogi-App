import React, { useState, useMemo } from 'react';
import { createInitialBoardState, BoardState, BoardSquare } from '../../types/shogi';
import { getMoveCandidates, applyMove } from '../../domain/shogi';
import { ShogiTable } from './ShogiTable';

export const ShogiResearchScreen: React.FC = () => {
  const [boardState, setBoardState] = useState<BoardState>(() => createInitialBoardState());
  const [selectedSquare, setSelectedSquare] = useState<{ row: number; col: number } | null>(null);

  // Compute move candidates for currently selected square
  const candidateSquares = useMemo(() => {
    if (!selectedSquare) return [];
    return getMoveCandidates(boardState.squares, selectedSquare);
  }, [boardState.squares, selectedSquare]);

  const handleSquareClick = (square: BoardSquare) => {
    // Case 1: No square currently selected
    if (!selectedSquare) {
      if (square.piece && square.piece.player === boardState.turn) {
        setSelectedSquare({ row: square.row, col: square.col });
      }
      return;
    }

    // Case 2: Clicked on already selected square -> Deselect
    if (selectedSquare.row === square.row && selectedSquare.col === square.col) {
      setSelectedSquare(null);
      return;
    }

    // Case 3: Clicked on another own piece -> Switch selection
    if (square.piece && square.piece.player === boardState.turn) {
      setSelectedSquare({ row: square.row, col: square.col });
      return;
    }

    // Case 4: Clicked on a legal move candidate square -> Execute move
    const isCandidate = candidateSquares.some(
      (c) => c.row === square.row && c.col === square.col
    );

    if (isCandidate) {
      const nextBoardState = applyMove(
        boardState,
        selectedSquare,
        { row: square.row, col: square.col }
      );
      setBoardState(nextBoardState);
      setSelectedSquare(null);
      return;
    }

    // Case 5: Clicked on an invalid square (opponent piece, empty non-candidate, etc.) -> Do nothing
  };

  const turnLabel = boardState.turn === 'sente' ? '先手番' : '後手番';
  const statusBadgeText = `対局中 / ${turnLabel}`;

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
            {statusBadgeText}
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
          selectedSquare={selectedSquare}
          candidateSquares={candidateSquares}
          lastMove={boardState.lastMove}
          onSquareClick={handleSquareClick}
        />
      </main>

      {/* Bottom Footer Notice */}
      <footer className="w-full max-w-4xl mt-8 pt-4 border-t border-stone-800/60 text-center">
        <p
          id="shogi-footer-notice"
          className="text-xs text-stone-400 font-sans tracking-wide select-none"
        >
          駒の選択・移動・駒取りが可能です（成駒・駒打ちは準備中）。
        </p>
      </footer>
    </div>
  );
};
