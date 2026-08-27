/**
 * Shogi Game State Transitions & Execution API
 * Pure functions to advance board state upon piece moves, handling captures, turns, move history,
 * and dual execution modes (Assist mode for UI / Strict mode for AI & engine experiments).
 */

import {
  BoardSquare,
  BoardState,
  ExecutionMode,
  FoulRecord,
  GameResult,
  IllegalMoveReason,
  MoveRecord,
  MovePromotion,
  MoveValidationResult,
  Piece,
  PieceType,
  Player,
  ProposerType,
  PromotionChoice,
} from '../../types/shogi';
import { Coordinate, toCoordinateLabel } from './coordinates';
import { getPromotionStatus } from './promotion';
import { validateMove } from './validation';
import { ILLEGAL_MOVE_MESSAGES } from './validation';

/**
 * Returns the traditional kanji representation of a piece for move notations.
 * Handles both unpromoted and promoted pieces.
 */
export function getPieceNotationKanji(
  type: PieceType,
  player: Player,
  isPromoted: boolean = false
): string {
  if (isPromoted) {
    switch (type) {
      case 'pawn':
        return 'と';
      case 'lance':
        return '成香';
      case 'knight':
        return '成桂';
      case 'silver':
        return '成銀';
      case 'rook':
        return '竜';
      case 'bishop':
        return '馬';
      default:
        break;
    }
  }

  switch (type) {
    case 'king':
      return player === 'sente' ? '王' : '玉';
    case 'rook':
      return '飛';
    case 'bishop':
      return '角';
    case 'gold':
      return '金';
    case 'silver':
      return '銀';
    case 'knight':
      return '桂';
    case 'lance':
      return '香';
    case 'pawn':
      return '歩';
    default:
      return '';
  }
}

/**
 * Generates a human-readable and structured Japanese move notation (e.g. "▲7六歩", "△3四歩", "▲5三成銀").
 */
export function generateMoveNotation(
  player: Player,
  piece: Piece,
  to: Coordinate,
  promotion: MovePromotion = 'none'
): string {
  const symbol = player === 'sente' ? '▲' : '△';
  const destCoord = toCoordinateLabel(to.row, to.col);
  const pieceKanji = getPieceNotationKanji(
    piece.type,
    player,
    piece.isPromoted ?? false
  );
  return `${symbol}${destCoord}${pieceKanji}${promotion === 'promote' ? '成' : ''}`;
}

/**
 * Deep clones the 9x9 board squares without mutating the original state.
 */
export function cloneBoardSquares(squares: BoardSquare[][]): BoardSquare[][] {
  return squares.map((row) =>
    row.map((square) => ({
      ...square,
      piece: square.piece ? { ...square.piece } : null,
    }))
  );
}

/**
 * Internal helper to apply a verified legal move to the board state.
 * NOT exported to ensure all external callers validate moves through executeMove.
 */
function internalApplyLegalMove(
  state: BoardState,
  from: Coordinate,
  to: Coordinate,
  promotion: MovePromotion
): BoardState {
  const originSquare = state.squares[from.row]?.[from.col];
  if (!originSquare || !originSquare.piece) {
    return state;
  }

  const movingPiece = originSquare.piece;
  const newSquares = cloneBoardSquares(state.squares);
  const targetSquare = newSquares[to.row][to.col];
  const targetPiece = targetSquare.piece;

  const nextSenteHand = [...state.senteHand];
  const nextGoteHand = [...state.goteHand];

  // If opponent piece is captured
  if (targetPiece) {
    const capturedPiece: Piece = {
      id: targetPiece.id,
      type: targetPiece.type,
      player: state.turn, // Transferred to capturer
      isPromoted: false,  // Promotion reset on capture
    };

    if (state.turn === 'sente') {
      nextSenteHand.push(capturedPiece);
    } else {
      nextGoteHand.push(capturedPiece);
    }
  }

  // Move the piece to destination
  newSquares[from.row][from.col].piece = null;
  newSquares[to.row][to.col].piece = {
    ...movingPiece,
    isPromoted: promotion === 'promote' ? true : movingPiece.isPromoted,
  };

  const notation = generateMoveNotation(state.turn, movingPiece, to, promotion);

  const moveRecord: MoveRecord = {
    moveNumber: state.moveNumber,
    player: state.turn,
    from: { row: from.row, col: from.col },
    to: { row: to.row, col: to.col },
    pieceType: movingPiece.type,
    capturedPieceType: targetPiece ? targetPiece.type : null,
    promotion,
    notation,
  };

  const nextTurn: Player = state.turn === 'sente' ? 'gote' : 'sente';

  return {
    squares: newSquares,
    senteHand: nextSenteHand,
    goteHand: nextGoteHand,
    turn: nextTurn,
    moveNumber: state.moveNumber + 1,
    status: 'active',
    viewMode: state.viewMode,
    history: [...state.history, moveRecord],
    lastMove: moveRecord,
    result: state.result ?? null,
    foulHistory: state.foulHistory ? [...state.foulHistory] : [],
  };
}

/**
 * Determines default execution mode according to the proposer type.
 * - 'human' or omitted: 'assist' (interactive UI assistance)
 * - 'local_ai' or 'shogi_engine': 'strict' (engine experimentation / foul loss rule)
 */
export function determineDefaultExecutionMode(
  proposer: ProposerType = 'human'
): ExecutionMode {
  switch (proposer) {
    case 'local_ai':
    case 'shogi_engine':
      return 'strict';
    case 'human':
    default:
      return 'assist';
  }
}

export interface ExecuteMoveOptions {
  mode?: ExecutionMode; // If omitted, defaults according to proposer
  proposer?: ProposerType; // Default: 'human'
  engineName?: string;
  promotion?: PromotionChoice;
}

export type MoveExecutionResult =
  | {
      type: 'applied';
      state: BoardState;
      move: MoveRecord;
    }
  | {
      type: 'rejected';
      state: BoardState;
      reason: IllegalMoveReason;
      message: string;
    }
  | {
      type: 'foul_loss';
      state: BoardState;
      foul: FoulRecord;
      result: GameResult;
    };

/**
 * Public API to execute a proposed move on the board state.
 *
 * Supports two distinct execution policies:
 * 1. Assist Mode (Human UI):
 *    - Rejects illegal moves cleanly without modifying the board or causing foul loss.
 * 2. Strict Mode (AI & Engine experiments):
 *    - Receives illegal moves as proposals and immediately triggers foul loss (反則負け).
 *    - Preserves squares, hands, turn, moveNumber, legal history, and lastMove intact.
 *    - Records foul in foulHistory and sets status: 'ended' with game result.
 */
export function executeMove(
  state: BoardState,
  from: Coordinate,
  to: Coordinate,
  options: ExecuteMoveOptions = {}
): MoveExecutionResult {
  const proposer = options.proposer ?? 'human';
  const mode = options.mode ?? determineDefaultExecutionMode(proposer);

  // If game is already ended, reject further moves without triggering new foul losses or mutating state
  if (state.status === 'ended') {
    return {
      type: 'rejected',
      state,
      reason: 'game_already_ended',
      message: '対局は既に終局しています。',
    };
  }

  let validation: MoveValidationResult = validateMove(state, from, to);
  let movePromotion: MovePromotion = 'none';

  if (validation.isValid) {
    const movingPiece = state.squares[from.row][from.col].piece!;
    const promotionStatus = getPromotionStatus(movingPiece, from, to);

    if (promotionStatus === 'none') {
      if (options.promotion === 'promote') {
        validation = {
          isValid: false,
          reason: 'invalid_promotion',
          message: ILLEGAL_MOVE_MESSAGES.invalid_promotion,
        };
      }
    } else if (promotionStatus === 'optional') {
      if (!options.promotion) {
        validation = {
          isValid: false,
          reason: 'promotion_choice_required',
          message: ILLEGAL_MOVE_MESSAGES.promotion_choice_required,
        };
      } else {
        movePromotion = options.promotion;
      }
    } else if (options.promotion !== 'promote') {
      validation = {
        isValid: false,
        reason: 'promotion_required',
        message: ILLEGAL_MOVE_MESSAGES.promotion_required,
      };
    } else {
      movePromotion = 'promote';
    }
  }

  // If move is legal, apply it through the internal helper
  if (validation.isValid) {
    const nextState = internalApplyLegalMove(state, from, to, movePromotion);
    return {
      type: 'applied',
      state: nextState,
      move: nextState.lastMove!,
    };
  }

  // If move is illegal:
  // Accurately record source piece if one exists on the board; do not fabricate a pieceType (e.g. pawn)
  const isFromInBounds =
    from &&
    typeof from.row === 'number' &&
    typeof from.col === 'number' &&
    from.row >= 0 &&
    from.row < 9 &&
    from.col >= 0 &&
    from.col < 9;

  const originSquare = isFromInBounds ? state.squares[from.row]?.[from.col] : undefined;
  const pieceType = originSquare?.piece?.type ?? null;

  const foulRecord: FoulRecord = {
    moveNumber: state.moveNumber,
    player: state.turn,
    from: { row: from?.row ?? -1, col: from?.col ?? -1 },
    to: { row: to?.row ?? -1, col: to?.col ?? -1 },
    pieceType,
    reason: validation.reason,
    message: validation.message,
    proposer,
    engineName: options.engineName,
    timestamp: Date.now(),
  };

  if (mode === 'strict') {
    const winner: Player = state.turn === 'sente' ? 'gote' : 'sente';
    const loser: Player = state.turn;

    const gameResult: GameResult = {
      winner,
      loser,
      endReason: 'foul_loss',
      foulReason: validation.reason,
      details: validation.message,
    };

    // Strict mode: Keep squares, hands, turn, moveNumber, history, lastMove UNCHANGED.
    // Set status to 'ended', attach result, and append to foulHistory.
    const endedState: BoardState = {
      ...state,
      status: 'ended',
      result: gameResult,
      foulHistory: [...(state.foulHistory ?? []), foulRecord],
    };

    return {
      type: 'foul_loss',
      state: endedState,
      foul: foulRecord,
      result: gameResult,
    };
  }

  // Assist mode: Reject without altering state
  return {
    type: 'rejected',
    state,
    reason: validation.reason,
    message: validation.message,
  };
}

/**
 * Backward compatible wrapper for applyMove (defaults to Assist mode).
 */
export function applyMove(
  state: BoardState,
  from: Coordinate,
  to: Coordinate
): BoardState {
  const piece = state.squares[from.row]?.[from.col]?.piece;
  const promotion = piece && getPromotionStatus(piece, from, to) === 'optional'
    ? 'decline'
    : undefined;
  const result = executeMove(state, from, to, { mode: 'assist', promotion });
  return result.state;
}
