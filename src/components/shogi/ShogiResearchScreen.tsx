import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createInitialBoardState, BoardState, BoardSquare, Piece, PieceType } from '../../types/shogi';
import {
  executeDrop,
  evaluateEnteringKingDeclaration,
  executeEnteringKingDeclaration,
  executeMove,
  executeResignation,
  getLegalDropSquares,
  getMoveCandidates,
  getPromotionStatus,
  PromotionStatus,
} from '../../domain/shogi';
import { ShogiTable } from './ShogiTable';
import { PromotionDialog } from './PromotionDialog';
import { ResignationDialog } from './ResignationDialog';
import { EnteringKingDeclarationDialog } from './EnteringKingDeclarationDialog';

interface ShogiResearchScreenProps {
  initialState?: BoardState;
}

interface PendingPromotion {
  from: { row: number; col: number };
  to: { row: number; col: number };
  status: Exclude<PromotionStatus, 'none'>;
}

type SelectionState =
  | { kind: 'none' }
  | { kind: 'board'; square: { row: number; col: number } }
  | { kind: 'hand'; pieceId: string; pieceType: PieceType };

export const ShogiResearchScreen: React.FC<ShogiResearchScreenProps> = ({ initialState }) => {
  const [boardState, setBoardState] = useState<BoardState>(() => initialState ?? createInitialBoardState());
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' });
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [isResignationDialogOpen, setIsResignationDialogOpen] = useState(false);
  const [isEnteringKingDialogOpen, setIsEnteringKingDialogOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    row: number;
    col: number;
    requestId: number;
  } | null>(null);
  const focusRequestId = useRef(0);
  const resignationButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreResignationFocus = useRef(false);
  const enteringKingButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreEnteringKingFocus = useRef(false);

  const isEnded = boardState.status === 'ended';
  const isResignationAvailable = boardState.status === 'active' || boardState.status === 'check';
  const isEnteringKingAvailable = boardState.status === 'active' || boardState.status === 'check';
  const isInteractionBlocked =
    isEnded || pendingPromotion !== null || isResignationDialogOpen || isEnteringKingDialogOpen;
  const selectedSquare = !isEnded && selection.kind === 'board' ? selection.square : null;
  const selectedHandPieceId = !isEnded && selection.kind === 'hand' ? selection.pieceId : null;

  // Compute candidates for the mutually exclusive board/hand selection.
  const candidateSquares = useMemo(() => {
    if (boardState.status === 'ended') return [];
    if (selection.kind === 'board') {
      return getMoveCandidates(boardState.squares, selection.square, boardState.turn);
    }
    if (selection.kind === 'hand') {
      return getLegalDropSquares(boardState, selection.pieceId);
    }
    return [];
  }, [boardState, selection]);

  const enteringKingEvaluation = useMemo(
    () => evaluateEnteringKingDeclaration(boardState),
    [boardState]
  );

  useEffect(() => {
    if (boardState.status !== 'ended') return;
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setIsResignationDialogOpen(false);
    setIsEnteringKingDialogOpen(false);
  }, [boardState.status]);

  useEffect(() => {
    if (isResignationDialogOpen || !shouldRestoreResignationFocus.current) return;
    shouldRestoreResignationFocus.current = false;
    resignationButtonRef.current?.focus();
  }, [isResignationDialogOpen]);

  useEffect(() => {
    if (isEnteringKingDialogOpen || !shouldRestoreEnteringKingFocus.current) return;
    shouldRestoreEnteringKingFocus.current = false;
    enteringKingButtonRef.current?.focus();
  }, [isEnteringKingDialogOpen]);

  const restoreBoardFocus = useCallback((square: { row: number; col: number }) => {
    focusRequestId.current += 1;
    setFocusRequest({ ...square, requestId: focusRequestId.current });
  }, []);

  const cancelPromotion = useCallback(() => {
    if (!pendingPromotion) return;
    const restoreSquare = pendingPromotion.from;
    setPendingPromotion(null);
    setSelection({ kind: 'none' });
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
    setSelection({ kind: 'none' });
    restoreBoardFocus(restoreSquare);
  };

  const openResignationDialog = () => {
    if (
      !isResignationAvailable ||
      pendingPromotion ||
      isResignationDialogOpen ||
      isEnteringKingDialogOpen
    ) return;
    setIsResignationDialogOpen(true);
  };

  const cancelResignation = useCallback(() => {
    shouldRestoreResignationFocus.current = true;
    setIsResignationDialogOpen(false);
  }, []);

  const confirmResignation = () => {
    const result = executeResignation(boardState);
    if (result.type === 'applied') {
      setBoardState(result.state);
      setSelection({ kind: 'none' });
      setPendingPromotion(null);
    }
    setIsResignationDialogOpen(false);
  };

  const openEnteringKingDialog = () => {
    if (
      !isEnteringKingAvailable ||
      pendingPromotion ||
      isResignationDialogOpen ||
      isEnteringKingDialogOpen
    ) return;
    setIsEnteringKingDialogOpen(true);
  };

  const cancelEnteringKing = useCallback(() => {
    shouldRestoreEnteringKingFocus.current = true;
    setIsEnteringKingDialogOpen(false);
  }, []);

  const confirmEnteringKing = () => {
    const result = executeEnteringKingDeclaration(boardState, {
      mode: 'assist',
      proposer: 'human',
    });
    if (result.type === 'applied') {
      setBoardState(result.state);
      setSelection({ kind: 'none' });
      setPendingPromotion(null);
    }
    setIsEnteringKingDialogOpen(false);
  };

  const handleSquareClick = (square: BoardSquare) => {
    if (isInteractionBlocked) return;
    if (selection.kind === 'hand') {
      if (square.piece?.player === boardState.turn) {
        setSelection({ kind: 'board', square: { row: square.row, col: square.col } });
        return;
      }

      const isDropCandidate = candidateSquares.some(
        (candidate) => candidate.row === square.row && candidate.col === square.col
      );
      if (!isDropCandidate) return;

      const result = executeDrop(
        boardState,
        selection.pieceId,
        { row: square.row, col: square.col },
        { mode: 'assist', proposer: 'human' }
      );
      if (result.type === 'applied') {
        setBoardState(result.state);
        setSelection({ kind: 'none' });
        restoreBoardFocus({ row: square.row, col: square.col });
      }
      return;
    }

    // Case 1: No square currently selected
    if (!selectedSquare) {
      if (square.piece && square.piece.player === boardState.turn) {
        setSelection({ kind: 'board', square: { row: square.row, col: square.col } });
      }
      return;
    }

    // Case 2: Clicked on already selected square -> Deselect
    if (selectedSquare.row === square.row && selectedSquare.col === square.col) {
      setSelection({ kind: 'none' });
      return;
    }

    // Case 3: Clicked on another own piece -> Switch selection
    if (square.piece && square.piece.player === boardState.turn) {
      setSelection({ kind: 'board', square: { row: square.row, col: square.col } });
      return;
    }

    // Case 4: Clicked on a legal move candidate square -> Execute move
    const isCandidate = candidateSquares.some(
      (c) => c.row === square.row && c.col === square.col
    );

    if (isCandidate) {
      const from = selectedSquare;
      const to = { row: square.row, col: square.col };
      const movingPiece = boardState.squares[from.row][from.col].piece;
      if (!movingPiece) return;
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
      setSelection({ kind: 'none' });
      return;
    }

    // Case 5: Clicked on an invalid square (opponent piece, empty non-candidate, etc.) -> Do nothing
  };

  const handleHandPieceSelect = (piece: Piece) => {
    if (isInteractionBlocked || piece.player !== boardState.turn) {
      return;
    }
    setSelection((current) =>
      current.kind === 'hand' && current.pieceId === piece.id
        ? { kind: 'none' }
        : { kind: 'hand', pieceId: piece.id, pieceType: piece.type }
    );
  };

  const handleScreenKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isResignationDialogOpen || isEnteringKingDialogOpen) return;
    if (event.key === 'Escape' && selection.kind === 'hand') {
      event.preventDefault();
      setSelection({ kind: 'none' });
    }
  };

  const turnLabel = boardState.turn === 'sente' ? '先手番' : '後手番';

  const statusBadgeInfo = useMemo(() => {
    if (boardState.status === 'ended' && boardState.result) {
      if (boardState.result.endReason === 'repetition') {
        return {
          text: '終局 / 千日手（無勝負）',
          isLive: false,
          bgColor: 'bg-stone-900/80 text-stone-300 border-stone-700/60',
          dotColor: 'bg-stone-500',
        };
      }

      if (boardState.result.endReason === 'entering_king_draw') {
        return {
          text: '終局 / 入玉宣言による無勝負',
          isLive: false,
          bgColor: 'bg-amber-950/80 text-amber-200 border-amber-700/60',
          dotColor: 'bg-amber-400',
        };
      }

      const winnerName = boardState.result.winner === 'sente' ? '先手' : '後手';
      const loserName = boardState.result.loser === 'sente' ? '先手' : '後手';
      if (boardState.result.endReason === 'entering_king_win') {
        return {
          text: `終局 / ${winnerName}勝ち（入玉宣言）`,
          isLive: false,
          bgColor: 'bg-amber-950/80 text-amber-200 border-amber-700/60',
          dotColor: 'bg-amber-400',
        };
      }
      if (boardState.result.endReason === 'entering_king_declaration_failure') {
        return {
          text: `終局 / ${loserName}敗け（入玉宣言失敗）`,
          isLive: false,
          bgColor: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
          dotColor: 'bg-rose-500',
        };
      }
      if (boardState.result.endReason === 'foul_loss') {
        if (boardState.result.foulReason === 'perpetual_check_repetition') {
          return {
            text: `終局 / ${loserName}反則負け（連続王手の千日手）`,
            isLive: false,
            bgColor: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
            dotColor: 'bg-rose-500',
          };
        }
        return {
          text: `終局 / ${winnerName}勝ち（${loserName}反則負け）`,
          isLive: false,
          bgColor: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
          dotColor: 'bg-rose-500',
        };
      }
      if (boardState.result.endReason === 'checkmate') {
        return {
          text: `終局 / ${winnerName}勝ち（詰み）`,
          isLive: false,
          bgColor: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
          dotColor: 'bg-rose-500',
        };
      }
      if (boardState.result.endReason === 'resignation') {
        return {
          text: `終局 / ${winnerName}勝ち（${loserName}投了）`,
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

    if (boardState.status === 'check') {
      return {
        text: `王手 / ${turnLabel}`,
        isLive: true,
        bgColor: 'bg-rose-950/70 text-rose-300 border-rose-800/50',
        dotColor: 'bg-rose-400',
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
      onKeyDown={handleScreenKeyDown}
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
        <div className="mt-2 flex max-w-full flex-wrap justify-center gap-2">
          <button
            ref={enteringKingButtonRef}
            type="button"
            onClick={openEnteringKingDialog}
            disabled={!isEnteringKingAvailable || pendingPromotion !== null || isResignationDialogOpen || isEnteringKingDialogOpen}
            aria-haspopup="dialog"
            aria-expanded={isEnteringKingDialogOpen}
            className="rounded border border-amber-700/70 bg-amber-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.12em] text-amber-100 shadow-inner outline-none transition hover:border-amber-500 hover:bg-amber-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            入玉宣言
          </button>
          <button
            ref={resignationButtonRef}
            type="button"
            onClick={openResignationDialog}
            disabled={!isResignationAvailable || pendingPromotion !== null || isResignationDialogOpen || isEnteringKingDialogOpen}
            aria-haspopup="dialog"
            aria-expanded={isResignationDialogOpen}
            className="rounded border border-rose-900/70 bg-stone-900/80 px-4 py-1.5 font-serif text-sm tracking-[0.14em] text-rose-200 shadow-inner outline-none transition hover:border-rose-700 hover:bg-rose-950/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            投了
          </button>
        </div>
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
          candidateKind={selection.kind === 'none' ? null : selection.kind === 'hand' ? 'drop' : 'move'}
          dropPieceType={selection.kind === 'hand' ? selection.pieceType : null}
          lastMove={boardState.lastMove}
          onSquareClick={isInteractionBlocked ? undefined : handleSquareClick}
          focusRequest={focusRequest}
          turn={boardState.turn}
          selectedHandPieceId={selectedHandPieceId}
          onHandPieceSelect={handleHandPieceSelect}
          pieceStandsDisabled={isInteractionBlocked}
        />
      </main>

      {pendingPromotion && !isEnded && (
        <PromotionDialog
          status={pendingPromotion.status}
          onPromote={() => completePromotionChoice('promote')}
          onDecline={() => completePromotionChoice('decline')}
          onCancel={cancelPromotion}
        />
      )}

      {isResignationDialogOpen && !isEnded && (
        <ResignationDialog
          resigningPlayer={boardState.turn}
          onConfirm={confirmResignation}
          onCancel={cancelResignation}
        />
      )}

      {isEnteringKingDialogOpen && !isEnded && (
        <EnteringKingDeclarationDialog
          evaluation={enteringKingEvaluation}
          onConfirm={confirmEnteringKing}
          onCancel={cancelEnteringKing}
        />
      )}

      {/* Bottom Footer Notice */}
      <footer className="w-full max-w-4xl mt-8 pt-4 border-t border-stone-800/60 text-center">
        <p
          id="shogi-footer-notice"
          className="text-xs text-stone-400 font-sans tracking-wide select-none"
        >
          駒の移動・成り・駒打ち、王手表示・一般的な詰み判定・終局処理に対応しています。千日手・連続王手の千日手の終局処理に対応しています。投了による終局処理に対応しています。入玉宣言による終局処理に対応しています。
        </p>
      </footer>
    </div>
  );
};
