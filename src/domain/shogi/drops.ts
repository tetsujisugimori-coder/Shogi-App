/** Validated piece-drop execution and notation. */
import {
  BoardState,
  DropFoulRecord,
  DropMoveRecord,
  Piece,
  Player,
  ProposerType,
  ExecutionMode,
} from '../../types/shogi';
import { Coordinate, toCoordinateLabel } from './coordinates';
import {
  FoulLossExecutionResult,
  RejectedExecutionResult,
  finalizeIllegalProposal,
} from './executionPolicy';
import {
  determineDefaultExecutionMode,
  getPieceNotationKanji,
} from './gameState';
import {
  getLegalDropSquares,
  simulateDropSquares,
  validateDrop,
} from './dropRules';
import { ILLEGAL_MOVE_MESSAGES } from './validation';
import { adjudicateAfterLegalMove } from './adjudication';
import { normalizePositionHistory } from './repetition';

export { getLegalDropSquares, simulateDropSquares, validateDrop } from './dropRules';

function getHands(state: BoardState): { current: Piece[]; opponent: Piece[] } {
  return state.turn === 'sente'
    ? { current: state.senteHand, opponent: state.goteHand }
    : { current: state.goteHand, opponent: state.senteHand };
}

export function generateDropNotation(player: Player, piece: Piece, to: Coordinate): string {
  const symbol = player === 'sente' ? '▲' : '△';
  return `${symbol}${toCoordinateLabel(to.row, to.col)}${getPieceNotationKanji(
    piece.type,
    player
  )}打`;
}

function internalApplyLegalDrop(
  state: BoardState,
  piece: Piece,
  to: Coordinate
): BoardState {
  const newSquares = simulateDropSquares(state.squares, piece, to);
  const nextSenteHand = [...state.senteHand];
  const nextGoteHand = [...state.goteHand];
  const activeHand = state.turn === 'sente' ? nextSenteHand : nextGoteHand;
  const pieceIndex = activeHand.findIndex((candidate) => candidate.id === piece.id);
  if (pieceIndex < 0) return state;
  activeHand.splice(pieceIndex, 1);

  const moveRecord: DropMoveRecord = {
    kind: 'drop',
    moveNumber: state.moveNumber,
    player: state.turn,
    from: null,
    to: { row: to.row, col: to.col },
    pieceType: piece.type,
    pieceId: piece.id,
    capturedPieceType: null,
    promotion: 'none',
    notation: generateDropNotation(state.turn, piece, to),
  };

  return {
    ...state,
    squares: newSquares,
    senteHand: nextSenteHand,
    goteHand: nextGoteHand,
    turn: state.turn === 'sente' ? 'gote' : 'sente',
    moveNumber: state.moveNumber + 1,
    status: 'active',
    history: [...state.history, moveRecord],
    lastMove: moveRecord,
    foulHistory: state.foulHistory ? [...state.foulHistory] : [],
  };
}

export interface ExecuteDropOptions {
  mode?: ExecutionMode;
  proposer?: ProposerType;
  engineName?: string;
}

export type DropExecutionResult =
  | { type: 'applied'; state: BoardState; move: DropMoveRecord }
  | RejectedExecutionResult
  | FoulLossExecutionResult;

/** Public validated execution API for piece drops. */
export function executeDrop(
  state: BoardState,
  pieceId: string,
  to: Coordinate,
  options: ExecuteDropOptions = {}
): DropExecutionResult {
  const proposer = options.proposer ?? 'human';
  const mode = options.mode ?? determineDefaultExecutionMode(proposer);
  const validation = validateDrop(state, pieceId, to);

  if (validation.isValid) {
    const piece = getHands(state).current.find((candidate) => candidate.id === pieceId);
    if (!piece) {
      return {
        type: 'rejected',
        state,
        reason: 'hand_piece_not_found',
        message: ILLEGAL_MOVE_MESSAGES.hand_piece_not_found,
      };
    }
    const normalizedState = normalizePositionHistory(state);
    const nextState = adjudicateAfterLegalMove(
      internalApplyLegalDrop(normalizedState, piece, to),
      state.turn
    );
    const move = nextState.lastMove;
    if (!move || move.kind !== 'drop') {
      return {
        type: 'rejected',
        state,
        reason: 'hand_piece_not_found',
        message: ILLEGAL_MOVE_MESSAGES.hand_piece_not_found,
      };
    }
    return { type: 'applied', state: nextState, move };
  }

  if (validation.reason === 'game_already_ended') {
    return {
      type: 'rejected',
      state,
      reason: validation.reason,
      message: validation.message,
    };
  }

  const allPieces = [...state.senteHand, ...state.goteHand];
  const pieceType = allPieces.find((candidate) => candidate.id === pieceId)?.type ?? null;
  const foulRecord: DropFoulRecord = {
    kind: 'drop',
    moveNumber: state.moveNumber,
    player: state.turn,
    from: null,
    to: { row: to?.row ?? -1, col: to?.col ?? -1 },
    pieceId,
    pieceType,
    reason: validation.reason,
    message: validation.message,
    proposer,
    engineName: options.engineName,
    timestamp: Date.now(),
  };

  return finalizeIllegalProposal(state, mode, foulRecord);
}
