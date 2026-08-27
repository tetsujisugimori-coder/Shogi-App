/**
 * Shogi Move Validation Engine
 * Pure functions to rigorously validate proposed moves and return detailed reasons for any illegality.
 */

import {
  BoardState,
  IllegalMoveReason,
  MoveValidationResult,
} from '../../types/shogi';
import { Coordinate, isWithinBoard } from './coordinates';
import { isKingInCheck } from './attacks';
import {
  getPseudoLegalMoves,
  simulateMoveSquares,
} from './moves';

/**
 * Human-friendly explanation messages for illegal move reasons.
 */
export const ILLEGAL_MOVE_MESSAGES: Record<IllegalMoveReason, string> = {
  out_of_bounds: '盤面外への着手はできません。',
  no_piece_at_source: '指定されたマスに駒が存在しません。',
  not_current_turn: '手番ではないプレイヤーの駒は動かせません。',
  not_own_piece: '自分の駒ではない駒を動かすことはできません。',
  invalid_piece_move: '駒の動きとして不正な位置への移動です。',
  occupied_by_own_piece: '味方の駒が存在するマスには移動できません。',
  captured_king: '相手の王将・玉将を直接取ることはできません。',
  dead_piece: 'これ以上進めない段への未成駒の移動は禁止されています（行き所のない駒）。',
  promotion_choice_required: '成るか不成かを選択してください。',
  invalid_promotion: 'この指し手では成ることができません。',
  promotion_required: 'この指し手では成りが必須です。',
  king_suicide: '王将・玉将を相手の利きがあるマスへ移動することはできません（自滅手）。',
  self_check_unresolved: '自玉が王手を受ける状態になる着手、または王手放置は反則です。',
  game_already_ended: '対局は既に終局しています。',
};

/**
 * Validates a proposed move against the current board state and returns a detailed validation result.
 */
export function validateMove(
  state: BoardState,
  from: Coordinate,
  to: Coordinate
): MoveValidationResult {
  // 1. Boundary check
  if (!isWithinBoard(from.row, from.col) || !isWithinBoard(to.row, to.col)) {
    return {
      isValid: false,
      reason: 'out_of_bounds',
      message: ILLEGAL_MOVE_MESSAGES.out_of_bounds,
    };
  }

  // 2. Source piece check
  const sourceSquare = state.squares[from.row]?.[from.col];
  if (!sourceSquare || !sourceSquare.piece) {
    return {
      isValid: false,
      reason: 'no_piece_at_source',
      message: ILLEGAL_MOVE_MESSAGES.no_piece_at_source,
    };
  }

  const piece = sourceSquare.piece;

  // 3. Turn & ownership check
  if (piece.player !== state.turn) {
    return {
      isValid: false,
      reason: 'not_current_turn',
      message: ILLEGAL_MOVE_MESSAGES.not_current_turn,
    };
  }

  const targetSquare = state.squares[to.row]?.[to.col];

  // 4. Target square occupied by own piece
  if (targetSquare?.piece && targetSquare.piece.player === piece.player) {
    return {
      isValid: false,
      reason: 'occupied_by_own_piece',
      message: ILLEGAL_MOVE_MESSAGES.occupied_by_own_piece,
    };
  }

  // 5. Target is opponent king (cannot capture King directly)
  if (targetSquare?.piece && targetSquare.piece.type === 'king') {
    return {
      isValid: false,
      reason: 'captured_king',
      message: ILLEGAL_MOVE_MESSAGES.captured_king,
    };
  }

  // 6. Geometric pseudo-legal move check
  const pseudoMoves = getPseudoLegalMoves(state.squares, from, piece);
  const isPseudoLegal = pseudoMoves.some(
    (c) => c.row === to.row && c.col === to.col
  );
  if (!isPseudoLegal) {
    return {
      isValid: false,
      reason: 'invalid_piece_move',
      message: ILLEGAL_MOVE_MESSAGES.invalid_piece_move,
    };
  }

  // 7. Self-check / King safety check
  const simulatedSquares = simulateMoveSquares(state.squares, from, to);
  if (isKingInCheck(simulatedSquares, piece.player)) {
    if (piece.type === 'king') {
      return {
        isValid: false,
        reason: 'king_suicide',
        message: ILLEGAL_MOVE_MESSAGES.king_suicide,
      };
    } else {
      return {
        isValid: false,
        reason: 'self_check_unresolved',
        message: ILLEGAL_MOVE_MESSAGES.self_check_unresolved,
      };
    }
  }

  return { isValid: true };
}
