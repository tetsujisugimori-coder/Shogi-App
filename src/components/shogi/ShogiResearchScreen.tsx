import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createInitialBoardState, BoardState, BoardSquare } from '../../types/shogi';
import {
  executeMove,
  getMoveCandidates,
  getPromotionStatus,
  PromotionStatus,
} from '../../domain/shogi';
import { ShogiTable } from './ShogiTable';
import { PromotionDialog } from './PromotionDialog';

interface ShogiResearchScreenProps {
  initialState?: BoardState;
}

interface PendingPromotion {
  from: { row: number; col: number };
  to: { row: number; col: number };
  status: Exclude<PromotionStatus, 'none'>;
}

export const ShogiResearchScreen: React.FC<ShogiResearchScreenProps> = ({ initialState }) => {
  const [boardState, setBoardState] = useState<BoardState>(() => initialState ?? createInitialBoardState());
  const [selectedSquare, setSelectedSquare] = useState<{ row: number; col: number } | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    row: number;
    col: number;
    requestId: number;
  } | null>(null);
  const focusRequestId = useRef(0);

  // Compute move candidates for currently selected square
  const candidateSquares = useMemo(() => {
    if (!selectedSquare) return [];
    return getMoveCandidates(boardState.squares, selectedSquare, boardState.turn);
  }, [boardState.squares, boardState.turn, selectedSquare]);

  const restoreBoardFocus = useCallback((square: { row: number; col: number }) => {
    focusRequestId.current += 1;
    setFocusRequest({ ...square, requestId: focusRequestId.current });
  }, []);

  const cancelPromotion = useCallback(() => {
    if (!pendingPromotion) return;
    const restoreSquare = pendingPromotion.from;
    setPendingPromotion(null);
    setSelectedSquare(null);
    restoreBoardFocus(restoreSquare);
  }, [pendingPromotion, restoreBoardFocus]);

  const completePromotionChoice = (promotion: 'promote' | 'decline') => {
    if (!pendingPromotion) return;

    const result = executeMove(boardState, pendingPromotion.from, pendingPromotion.to, {
      mode: 'assist',
      proposer: 'human',
      promotion,
    });

    if (result.type === 'applied') {
      setBoardState(result.state);
    }

    const restoreSquare = result.type === 'applied' ? pendingPromotion.to : pendingPromotion.from;
    setPendingPromotion(null);
    setSelectedSquare(null);
    restoreBoardFocus(restoreSquare);
  };

  const handleSquareClick = (square: BoardSquare) => {
    if (pendingPromotion) return;
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
      const from = selectedSquare;
      const to = { row: square.row, col: square.col };
      const movingPiece = boardState.squares[from.row][from.col].piece!;
      const promotionStatus = getPromotionStatus(movingPiece, from, to);

      if (promotionStatus !== 'none') {
        setPendingPromotion({ from, to, status: promotionStatus });
        return;
      }

      const result = executeMove(boardState, from, to, {
        mode: 'assist',
        proposer: 'human',
      });
      if (result.type === 'applied') {
        setBoardState(result.state);
      }
      setSelectedSquare(null);
      return;
    }

    // Case 5: Clicked on an invalid square (opponent piece, empty non-candidate, etc.) -> Do nothing
  };

  const turnLabel = boardState.turn === 'sente' ? '先手番' : '後手番';

  const statusBadgeInfo = useMemo(() => {
    if (boardState.status === 'ended' && boardState.result) {
      const winnerName = boardState.result.winner === 'sente' ? '先手' : '後手';
      const loserName = boardState.result.loser === 'sente' ? '先手' : '後手';
      if (boardState.result.endReason === 'foul_loss') {
        return {
          text: `終局 / ${winnerName}勝ち（${loserName}反則負け）`,
          isLive: false,
          bgColor: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
          dotColor: 'bg-rose-500',
        };
      }
      return {
        text: `終局 / ${winnerName}勝ち`,
        isLive: false,
        bgColor: 'bg-stone-900/80 text-stone-300 border-stone-700/60',
        dotColor: 'bg-stone-500',
      };
    }

    return {
      text: `対局中 / ${turnLabel}`,
      isLive: true,
      bgColor: 'bg-amber-950/70 text-amber-300 border-amber-800/50',
      dotColor: 'bg-amber-400',
    };
  }, [boardState.status, boardState.result, turnLabel]);

  return (
    <div
      id="shogi-research-screen"
      data-turn={boardState.turn}
      data-move-number={boardState.moveNumber}
      data-history-count={boardState.history.length}
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
            className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-medium ${statusBadgeInfo.bgColor} border shadow-inner`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${statusBadgeInfo.dotColor} ${statusBadgeInfo.isLive ? 'animate-pulse' : ''}`}
            />
            {statusBadgeInfo.text}
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
          onSquareClick={pendingPromotion ? undefined : handleSquareClick}
          focusRequest={focusRequest}
        />
      </main>

      {pendingPromotion && (
        <PromotionDialog
          status={pendingPromotion.status}
          onPromote={() => completePromotionChoice('promote')}
          onDecline={() => completePromotionChoice('decline')}
          onCancel={cancelPromotion}
        />
      )}

      {/* Bottom Footer Notice */}
      <footer className="w-full max-w-4xl mt-8 pt-4 border-t border-stone-800/60 text-center">
        <p
          id="shogi-footer-notice"
          className="text-xs text-stone-400 font-sans tracking-wide select-none"
        >
          駒の選択・移動・駒取り・成り選択が可能です（駒打ちは準備中）。
        </p>
      </footer>
    </div>
  );
};
