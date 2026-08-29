import type {
  BoardState,
  EnteringKingDeclarationFailureGameResult,
  EnteringKingDrawGameResult,
  EnteringKingWinGameResult,
  ExecutionMode,
  Piece,
  Player,
  ProposerType,
} from '../../types/shogi';
import { findKingSquare, isKingInCheck } from './attacks';
import { determineDefaultExecutionMode } from './gameState';

export const ENTERING_KING_REQUIRED_CAMP_PIECES = 10;
export const ENTERING_KING_DRAW_POINTS = 24;
export const ENTERING_KING_WIN_POINTS = 31;
export const ENTERING_KING_MOVE_LIMIT = 500;

export type EnteringKingOutcome = 'win' | 'draw' | 'ineligible';

export type EnteringKingIneligibilityReason =
  | 'game_not_in_progress'
  | 'move_limit_reached'
  | 'king_missing'
  | 'king_not_in_enemy_camp'
  | 'king_in_check'
  | 'insufficient_camp_pieces'
  | 'insufficient_points';

export interface EnteringKingEvaluation {
  declarer: Player;
  isGameInProgress: boolean;
  completedMoves: number;
  isBeforeMoveLimit: boolean;
  kingExists: boolean;
  isKingInEnemyCamp: boolean;
  isKingNotInCheck: boolean;
  campPieceCount: number;
  requiredCampPieceCount: number;
  points: number;
  outcome: EnteringKingOutcome;
  reasons: EnteringKingIneligibilityReason[];
}

export interface ExecuteEnteringKingDeclarationOptions {
  mode?: ExecutionMode;
  proposer?: ProposerType;
}

export type EnteringKingDeclarationRejectionReason =
  | 'game_already_ended'
  | 'entering_king_declaration_not_available'
  | EnteringKingIneligibilityReason;

export type EnteringKingDeclarationExecutionResult =
  | {
      type: 'applied';
      state: BoardState;
      evaluation: EnteringKingEvaluation;
      result: EnteringKingWinGameResult | EnteringKingDrawGameResult;
    }
  | {
      type: 'rejected';
      state: BoardState;
      evaluation: EnteringKingEvaluation;
      reason: EnteringKingDeclarationRejectionReason;
      message: string;
    }
  | {
      type: 'declaration_failure';
      state: BoardState;
      evaluation: EnteringKingEvaluation;
      result: EnteringKingDeclarationFailureGameResult;
    };

const REASON_MESSAGES: Record<EnteringKingIneligibilityReason, string> = {
  game_not_in_progress: '対局中の局面ではありません。',
  move_limit_reached: '完了手数が500手に達しています。',
  king_missing: '宣言側の玉が盤上に存在しません。',
  king_not_in_enemy_camp: '宣言側の玉が敵陣3段目以内に入っていません。',
  king_in_check: '宣言側の玉が王手を受けています。',
  insufficient_camp_pieces: '敵陣3段目以内の自駒が、玉を除いて10枚に達していません。',
  insufficient_points: '宣言対象の点数が24点に達していません。',
};

export function getEnteringKingReasonMessage(
  reason: EnteringKingIneligibilityReason
): string {
  return REASON_MESSAGES[reason];
}

/** Returns whether a row belongs to the opponent's three-rank camp for a player. */
export function isInEnemyCamp(player: Player, row: number): boolean {
  return player === 'sente' ? row >= 0 && row <= 2 : row >= 6 && row <= 8;
}

function getPiecePoints(piece: Piece): number {
  if (piece.type === 'king') return 0;
  return piece.type === 'rook' || piece.type === 'bishop' ? 5 : 1;
}

/** Counts the declarer's non-king board pieces in the opponent's camp. */
export function countEnteringKingCampPieces(
  state: BoardState,
  player: Player = state.turn
): number {
  let count = 0;
  for (const row of state.squares) {
    for (const square of row) {
      const piece = square.piece;
      if (
        piece &&
        piece.player === player &&
        piece.type !== 'king' &&
        isInEnemyCamp(player, square.row)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** Scores the declarer's hand plus their pieces in the opponent's camp (king scores zero). */
export function calculateEnteringKingPoints(
  state: BoardState,
  player: Player = state.turn
): number {
  const hand = player === 'sente' ? state.senteHand : state.goteHand;
  let points = hand.reduce((total, piece) => {
    return piece.player === player ? total + getPiecePoints(piece) : total;
  }, 0);

  for (const row of state.squares) {
    for (const square of row) {
      const piece = square.piece;
      if (piece?.player === player && isInEnemyCamp(player, square.row)) {
        points += getPiecePoints(piece);
      }
    }
  }
  return points;
}

/** Evaluates every official entering-king declaration condition for the current side to move. */
export function evaluateEnteringKingDeclaration(state: BoardState): EnteringKingEvaluation {
  const declarer = state.turn;
  const isGameInProgress = state.status === 'active' || state.status === 'check';
  const completedMoves = state.moveNumber - 1;
  const isBeforeMoveLimit = completedMoves < ENTERING_KING_MOVE_LIMIT;
  const kingSquare = findKingSquare(state.squares, declarer);
  const kingExists = kingSquare !== null;
  const isKingInEnemyCamp = kingSquare !== null && isInEnemyCamp(declarer, kingSquare.row);
  const isKingNotInCheck = kingSquare !== null && !isKingInCheck(state.squares, declarer);
  const campPieceCount = countEnteringKingCampPieces(state, declarer);
  const points = calculateEnteringKingPoints(state, declarer);
  const reasons: EnteringKingIneligibilityReason[] = [];

  if (!isGameInProgress) reasons.push('game_not_in_progress');
  if (!isBeforeMoveLimit) reasons.push('move_limit_reached');
  if (!kingExists) reasons.push('king_missing');
  if (kingExists && !isKingInEnemyCamp) reasons.push('king_not_in_enemy_camp');
  if (kingExists && !isKingNotInCheck) reasons.push('king_in_check');
  if (campPieceCount < ENTERING_KING_REQUIRED_CAMP_PIECES) {
    reasons.push('insufficient_camp_pieces');
  }
  if (points < ENTERING_KING_DRAW_POINTS) reasons.push('insufficient_points');

  const outcome: EnteringKingOutcome =
    reasons.length > 0
      ? 'ineligible'
      : points >= ENTERING_KING_WIN_POINTS
        ? 'win'
        : 'draw';

  return {
    declarer,
    isGameInProgress,
    completedMoves,
    isBeforeMoveLimit,
    kingExists,
    isKingInEnemyCamp,
    isKingNotInCheck,
    campPieceCount,
    requiredCampPieceCount: ENTERING_KING_REQUIRED_CAMP_PIECES,
    points,
    outcome,
    reasons,
  };
}

/** Applies a declaration without creating a move, position, or foul-history record. */
export function executeEnteringKingDeclaration(
  state: BoardState,
  options: ExecuteEnteringKingDeclarationOptions = {}
): EnteringKingDeclarationExecutionResult {
  const evaluation = evaluateEnteringKingDeclaration(state);

  if (state.status === 'ended') {
    return {
      type: 'rejected',
      state,
      evaluation,
      reason: 'game_already_ended',
      message: '対局は既に終局しています。',
    };
  }

  if (state.status !== 'active' && state.status !== 'check') {
    return {
      type: 'rejected',
      state,
      evaluation,
      reason: 'entering_king_declaration_not_available',
      message: '現在の対局状態では入玉宣言できません。',
    };
  }

  const proposer = options.proposer ?? 'human';
  const mode = options.mode ?? determineDefaultExecutionMode(proposer);
  if (evaluation.outcome === 'ineligible') {
    if (mode !== 'strict') {
      const reason = evaluation.reasons[0];
      return {
        type: 'rejected',
        state,
        evaluation,
        reason,
        message: getEnteringKingReasonMessage(reason),
      };
    }

    const loser = state.turn;
    const winner: Player = loser === 'sente' ? 'gote' : 'sente';
    const result: EnteringKingDeclarationFailureGameResult = {
      winner,
      loser,
      endReason: 'entering_king_declaration_failure',
      details: `${loser === 'sente' ? '先手' : '後手'}の入玉宣言失敗`,
    };
    return {
      type: 'declaration_failure',
      state: { ...state, status: 'ended', result },
      evaluation,
      result,
    };
  }

  const result: EnteringKingWinGameResult | EnteringKingDrawGameResult =
    evaluation.outcome === 'win'
      ? {
          winner: state.turn,
          loser: state.turn === 'sente' ? 'gote' : 'sente',
          endReason: 'entering_king_win',
          details: `${state.turn === 'sente' ? '先手' : '後手'}の入玉宣言勝ち`,
        }
      : {
          winner: null,
          loser: null,
          endReason: 'entering_king_draw',
          details: '入玉宣言による無勝負',
        };

  return {
    type: 'applied',
    state: { ...state, status: 'ended', result },
    evaluation,
    result,
  };
}
