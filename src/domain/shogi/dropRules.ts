/** Pure piece-drop validation, candidate generation, and simulation. */
import {
  BoardSquare,
  BoardState,
  MoveValidationResult,
  Piece,
  Player,
} from '../../types/shogi';
import { isKingInCheck } from './attacks';
import { cloneBoardSquares, getOpponent } from './boardStateUtils';
import { Coordinate, isWithinBoard } from './coordinates';
import { getLegalMoves } from './moves';
import { ILLEGAL_MOVE_MESSAGES } from './validation';
import type { SearchDiagnostics, DropPieceType } from './searchDiagnostics';

function getHands(state: BoardState): { current: Piece[]; opponent: Piece[] } {
  return state.turn === 'sente'
    ? { current: state.senteHand, opponent: state.goteHand }
    : { current: state.goteHand, opponent: state.senteHand };
}

function isDeadDrop(piece: Piece, to: Coordinate): boolean {
  if (piece.type !== 'pawn' && piece.type !== 'lance' && piece.type !== 'knight') {
    return false;
  }

  if (piece.player === 'sente') {
    return piece.type === 'knight' ? to.row <= 1 : to.row === 0;
  }
  return piece.type === 'knight' ? to.row >= 7 : to.row === 8;
}

function wouldBeNifu(squares: BoardSquare[][], piece: Piece, to: Coordinate): boolean {
  if (piece.type !== 'pawn') return false;

  return squares.some((row) => {
    const boardPiece = row[to.col].piece;
    return (
      boardPiece?.player === piece.player &&
      boardPiece.type === 'pawn' &&
      !boardPiece.isPromoted
    );
  });
}

/** Returns an immutable board copy with `piece` dropped at `to`. */
export function simulateDropSquares(
  squares: BoardSquare[][],
  piece: Piece,
  to: Coordinate
): BoardSquare[][] {
  const nextSquares = cloneBoardSquares(squares);
  if (!isWithinBoard(to.row, to.col)) return nextSquares;

  nextSquares[to.row][to.col].piece = {
    ...piece,
    isPromoted: false,
  };
  return nextSquares;
}

/** Validation only: readers never mutate shared rows, squares, or pieces. */
function prepareDropValidationSquares(
  squares: BoardSquare[][],
  piece: Piece,
  to: Coordinate
): BoardSquare[][] {
  const nextSquares = squares.slice();
  const destinationRow = squares[to.row].slice();
  nextSquares[to.row] = destinationRow;
  destinationRow[to.col] = {
    ...squares[to.row][to.col],
    piece: { ...piece, isPromoted: false },
  };
  return nextSquares;
}

function hasLegalBoardMoveResponseToPawnCheck(
  squares: BoardSquare[][],
  respondingPlayer: Player
): boolean {
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = squares[row][col].piece;
      if (
        piece?.player === respondingPlayer &&
        getLegalMoves(squares, { row, col }, respondingPlayer).length > 0
      ) {
        return true;
      }
    }
  }
  return false;
}

function isPawnDropMateOnSimulatedBoard(
  squares: BoardSquare[][],
  droppingPlayer: Player
): boolean {
  const respondingPlayer = getOpponent(droppingPlayer);

  if (!isKingInCheck(squares, respondingPlayer)) {
    return false;
  }

  // A directly checking pawn cannot be answered by interposing a dropped piece.
  return !hasLegalBoardMoveResponseToPawnCheck(squares, respondingPlayer);
}

/** Validates one proposed drop in the documented rule order. */
export function validateDrop(
  state: BoardState,
  pieceId: string,
  to: Coordinate,
  diagnostics?: SearchDiagnostics
): MoveValidationResult {
  if (state.status === 'ended') {
    return {
      isValid: false,
      reason: 'game_already_ended',
      message: ILLEGAL_MOVE_MESSAGES.game_already_ended,
    };
  }

  if (!isWithinBoard(to.row, to.col)) {
    return {
      isValid: false,
      reason: 'out_of_bounds',
      message: ILLEGAL_MOVE_MESSAGES.out_of_bounds,
    };
  }

  const hands = getHands(state);
  const piece = hands.current.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    const opponentPiece = hands.opponent.find((candidate) => candidate.id === pieceId);
    const reason = opponentPiece ? 'not_own_hand_piece' : 'hand_piece_not_found';
    return {
      isValid: false,
      reason,
      message: ILLEGAL_MOVE_MESSAGES[reason],
    };
  }

  if (piece.player !== state.turn) {
    return {
      isValid: false,
      reason: 'not_own_hand_piece',
      message: ILLEGAL_MOVE_MESSAGES.not_own_hand_piece,
    };
  }

  if (piece.type === 'king') {
    return {
      isValid: false,
      reason: 'undroppable_piece',
      message: ILLEGAL_MOVE_MESSAGES.undroppable_piece,
    };
  }

  if (piece.isPromoted) {
    return {
      isValid: false,
      reason: 'invalid_hand_piece_state',
      message: ILLEGAL_MOVE_MESSAGES.invalid_hand_piece_state,
    };
  }

  if (state.squares[to.row][to.col].piece) {
    return {
      isValid: false,
      reason: 'occupied_drop_square',
      message: ILLEGAL_MOVE_MESSAGES.occupied_drop_square,
    };
  }

  if (isDeadDrop(piece, to)) {
    return {
      isValid: false,
      reason: 'dead_piece_drop',
      message: ILLEGAL_MOVE_MESSAGES.dead_piece_drop,
    };
  }

  if (wouldBeNifu(state.squares, piece, to)) {
    return {
      isValid: false,
      reason: 'nifu',
      message: ILLEGAL_MOVE_MESSAGES.nifu,
    };
  }

  const dropType = piece.type as DropPieceType;
  const simulatedSquares = diagnostics
    ? diagnostics.measureDropStage(dropType, 'drop-board-setup', () => prepareDropValidationSquares(state.squares, piece, to))
    : prepareDropValidationSquares(state.squares, piece, to);
  if (diagnostics
    ? diagnostics.measureDropStage(dropType, 'own-check', () => isKingInCheck(simulatedSquares, state.turn))
    : isKingInCheck(simulatedSquares, state.turn)) {
    return {
      isValid: false,
      reason: 'self_check_unresolved',
      message: ILLEGAL_MOVE_MESSAGES.self_check_unresolved,
    };
  }

  if (
    piece.type === 'pawn' &&
    !piece.isPromoted &&
    (diagnostics
      ? diagnostics.measureDropStage(dropType, 'pawn-drop-mate', () => isPawnDropMateOnSimulatedBoard(simulatedSquares, state.turn))
      : isPawnDropMateOnSimulatedBoard(simulatedSquares, state.turn))
  ) {
    return {
      isValid: false,
      reason: 'pawn_drop_mate',
      message: ILLEGAL_MOVE_MESSAGES.pawn_drop_mate,
    };
  }

  return { isValid: true };
}

/** Returns every legal destination for the selected hand-piece ID. */
export function getLegalDropSquares(state: BoardState, pieceId: string, diagnostics?: SearchDiagnostics): Coordinate[] {
  if (state.status === 'ended') return [];
  const piece = getHands(state).current.find((candidate) => candidate.id === pieceId);
  if (!piece || piece.player !== state.turn || piece.type === 'king' || piece.isPromoted) {
    return [];
  }

  const legalSquares: Coordinate[] = [];
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const to = { row, col };
      const result = validateDrop(state, pieceId, to, diagnostics);
      diagnostics?.recordDropResult(piece.type as DropPieceType, result.isValid ? undefined : result.reason);
      if (result.isValid) {
        legalSquares.push(to);
      }
    }
  }
  return legalSquares;
}
