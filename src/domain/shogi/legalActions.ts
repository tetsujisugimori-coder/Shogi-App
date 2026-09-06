/**
 * Deterministic, public enumeration of every currently legal shogi action.
 *
 * This deliberately composes the existing move, promotion, and drop rule APIs
 * rather than owning another copy of the game rules. It is suitable as the
 * common input boundary for local AI, search, and engine adapters.
 */
import {
  BoardState,
  ExecutionMode,
  MovePromotion,
  PieceType,
  Player,
  ProposerType,
} from '../../types/shogi';
import { Coordinate } from './coordinates';
import { getLegalDropSquares } from './dropRules';
import { DropExecutionResult, executeDrop } from './drops';
import { MoveExecutionResult, executeMove } from './gameState';
import { getLegalMoves } from './moves';
import { getPromotionStatus } from './promotion';

export interface LegalMoveAction {
  kind: 'move';
  player: Player;
  from: Coordinate;
  to: Coordinate;
  pieceType: PieceType;
  promotion: MovePromotion;
}

export interface LegalDropAction {
  kind: 'drop';
  player: Player;
  pieceId: string;
  pieceType: PieceType;
  to: Coordinate;
  promotion: 'none';
}

export type LegalAction = LegalMoveAction | LegalDropAction;

export interface ExecuteLegalActionOptions {
  mode?: ExecutionMode;
  proposer?: ProposerType;
  engineName?: string;
}

export type LegalActionExecutionResult = MoveExecutionResult | DropExecutionResult;

/**
 * Stable hand-piece ordering used after all board moves. Keeping this explicit
 * makes generated action lists reproducible across callers.
 */
const DROP_PIECE_TYPE_ORDER = [
  'rook',
  'bishop',
  'gold',
  'silver',
  'knight',
  'lance',
  'pawn',
] as const satisfies readonly Exclude<PieceType, 'king'>[];

function compareCoordinates(left: Coordinate, right: Coordinate): number {
  return left.row - right.row || left.col - right.col;
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { row: coordinate.row, col: coordinate.col };
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Returns every legal action for the player whose turn it is.
 *
 * Order is part of this API's contract: board moves (source row/column,
 * destination row/column, decline before promote) precede drops. Drops use
 * the fixed piece-type order above and then destination row/column. When a
 * hand contains identical pieces, the lexicographically smallest ID is the
 * representative action because the destinations are otherwise equivalent.
 */
export function getLegalActions(state: BoardState): LegalAction[] {
  if (state.status === 'ended') return [];

  const actions: LegalAction[] = [];

  for (let row = 0; row < state.squares.length; row += 1) {
    for (let col = 0; col < state.squares[row].length; col += 1) {
      const piece = state.squares[row][col].piece;
      if (!piece || piece.player !== state.turn) continue;

      const from = { row, col };
      const destinations = getLegalMoves(state.squares, from, state.turn)
        .slice()
        .sort(compareCoordinates);

      for (const destination of destinations) {
        const promotionStatus = getPromotionStatus(piece, from, destination);
        const promotions: readonly MovePromotion[] =
          promotionStatus === 'optional'
            ? ['decline', 'promote']
            : promotionStatus === 'required'
              ? ['promote']
              : ['none'];

        for (const promotion of promotions) {
          actions.push({
            kind: 'move',
            player: state.turn,
            from: copyCoordinate(from),
            to: copyCoordinate(destination),
            pieceType: piece.type,
            promotion,
          });
        }
      }
    }
  }

  const currentHand = state.turn === 'sente' ? state.senteHand : state.goteHand;
  for (const pieceType of DROP_PIECE_TYPE_ORDER) {
    const representativePieceId = currentHand
      .filter(
        (piece) =>
          piece.player === state.turn &&
          piece.type === pieceType &&
          !piece.isPromoted
      )
      .map((piece) => piece.id)
      .sort(compareIds)[0];

    if (!representativePieceId) continue;

    const destinations = getLegalDropSquares(state, representativePieceId)
      .slice()
      .sort(compareCoordinates);
    for (const destination of destinations) {
      actions.push({
        kind: 'drop',
        player: state.turn,
        pieceId: representativePieceId,
        pieceType,
        to: copyCoordinate(destination),
        promotion: 'none',
      });
    }
  }

  return actions;
}

/** Executes an enumerated action through the existing validated execution APIs. */
export function executeLegalAction(
  state: BoardState,
  action: LegalAction,
  options: ExecuteLegalActionOptions = {}
): LegalActionExecutionResult {
  if (action.kind === 'drop') {
    return executeDrop(state, action.pieceId, action.to, options);
  }

  if (action.promotion === 'none') {
    return executeMove(state, action.from, action.to, options);
  }

  return executeMove(state, action.from, action.to, {
    ...options,
    promotion: action.promotion,
  });
}
