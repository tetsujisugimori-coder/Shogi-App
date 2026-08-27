/**
 * Shogi Game State Transitions
 * Pure functions to advance board state upon piece moves, handling captures, turns, and move history.
 */

import { BoardSquare, BoardState, MoveRecord, Piece, PieceType, Player } from '../../types/shogi';
import { Coordinate, isWithinBoard, toCoordinateLabel } from './coordinates';
import { getMoveCandidates } from './moves';

/**
 * Returns the traditional single kanji representation of a piece type for move notations.
 */
export function getPieceNotationKanji(type: PieceType, player: Player): string {
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
 * Generates a human-readable and structured Japanese move notation (e.g. "▲7六歩", "△3四歩").
 */
export function generateMoveNotation(
  player: Player,
  piece: Piece,
  to: Coordinate
): string {
  const symbol = player === 'sente' ? '▲' : '△';
  const destCoord = toCoordinateLabel(to.row, to.col);
  const pieceKanji = getPieceNotationKanji(piece.type, player);
  return `${symbol}${destCoord}${pieceKanji}`;
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
 * Applies a move from `from` to `to` on the given board state.
 * Returns a new BoardState if valid, or the original state if the move is invalid.
 *
 * Operations executed:
 * 1. Validates that `from` has the current player's piece.
 * 2. Validates that `to` is in the legal move candidates.
 * 3. Handles piece capture:
 *    - Removes opponent piece from board
 *    - Updates player of captured piece to capturer
 *    - Resets isPromoted to false
 *    - Adds to capturer's hand preserving id and type
 * 4. Moves the piece to the destination square.
 * 5. Advances turn (sente <-> gote).
 * 6. Increments moveNumber.
 * 7. Records the structured move into history and updates lastMove.
 */
export function applyMove(
  state: BoardState,
  from: Coordinate,
  to: Coordinate
): BoardState {
  if (!isWithinBoard(from.row, from.col) || !isWithinBoard(to.row, to.col)) {
    return state;
  }

  const originSquare = state.squares[from.row]?.[from.col];
  if (!originSquare || !originSquare.piece) {
    return state;
  }

  const movingPiece = originSquare.piece;
  if (movingPiece.player !== state.turn) {
    return state;
  }

  // Validate destination against legal move candidates
  const candidates = getMoveCandidates(state.squares, from);
  const isLegal = candidates.some((c) => c.row === to.row && c.col === to.col);
  if (!isLegal) {
    return state;
  }

  // Deep clone squares for immutable state update
  const newSquares = cloneBoardSquares(state.squares);
  const targetSquare = newSquares[to.row][to.col];
  const targetPiece = targetSquare.piece;

  let nextSenteHand = [...state.senteHand];
  let nextGoteHand = [...state.goteHand];

  // If opponent piece is captured
  if (targetPiece) {
    const capturedPiece: Piece = {
      id: targetPiece.id,
      type: targetPiece.type,
      player: state.turn, // Becomes capturer's piece
      isPromoted: false,  // Reset promotion status
    };

    if (state.turn === 'sente') {
      nextSenteHand.push(capturedPiece);
    } else {
      nextGoteHand.push(capturedPiece);
    }
  }

  // Move the piece to destination
  newSquares[from.row][from.col].piece = null;
  newSquares[to.row][to.col].piece = { ...movingPiece };

  const notation = generateMoveNotation(state.turn, movingPiece, to);

  const moveRecord: MoveRecord = {
    moveNumber: state.moveNumber,
    player: state.turn,
    from: { row: from.row, col: from.col },
    to: { row: to.row, col: to.col },
    pieceType: movingPiece.type,
    capturedPieceType: targetPiece ? targetPiece.type : null,
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
  };
}
