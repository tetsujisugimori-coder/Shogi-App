import type {
  AgreedJishogiDrawGameResult,
  AgreedJishogiPointLossGameResult,
  BoardState,
  Player,
} from '../../types/shogi';
import { findKingSquare } from './attacks';
import { isInEnemyCamp } from './enteringKing';
import { getJishogiPiecePoints } from './jishogiPoints';
import { createPositionKey } from './repetition';

export const AGREED_JISHOGI_REQUIRED_POINTS = 24;

export type AgreedJishogiOutcome =
  | { kind: 'draw' }
  | { kind: 'point_loss'; winner: Player; loser: Player }
  | { kind: 'invalid_point_distribution' };

export type AgreedJishogiIneligibilityReason =
  | 'game_not_in_progress'
  | 'sente_king_missing'
  | 'gote_king_missing'
  | 'no_king_in_enemy_camp';

export interface AgreedJishogiEvaluation {
  proposer: Player;
  responder: Player;
  isGameInProgress: boolean;
  senteKingExists: boolean;
  goteKingExists: boolean;
  senteKingInEnemyCamp: boolean;
  goteKingInEnemyCamp: boolean;
  hasEnteringKing: boolean;
  sentePoints: number;
  gotePoints: number;
  outcome: AgreedJishogiOutcome;
  reasons: AgreedJishogiIneligibilityReason[];
  canPropose: boolean;
}

export interface AgreedJishogiProposal {
  kind: 'agreed_jishogi_proposal';
  proposer: Player;
  responder: Player;
  positionKey: string;
  moveNumber: number;
  sentePoints: number;
  gotePoints: number;
}

export type AgreedJishogiProposalRejectionReason =
  | 'game_already_ended'
  | 'agreed_jishogi_not_available'
  | 'proposer_not_current_turn'
  | AgreedJishogiIneligibilityReason;

export type AgreedJishogiProposalResult =
  | {
      type: 'proposed';
      state: BoardState;
      proposal: AgreedJishogiProposal;
      evaluation: AgreedJishogiEvaluation;
    }
  | {
      type: 'rejected';
      state: BoardState;
      evaluation: AgreedJishogiEvaluation;
      reason: AgreedJishogiProposalRejectionReason;
      message: string;
    };

export type AgreedJishogiCancellationRejectionReason =
  | 'proposal_mismatch'
  | 'only_proposer_can_cancel';

export type AgreedJishogiCancellationResult =
  | { type: 'cancelled'; state: BoardState }
  | {
      type: 'rejected';
      state: BoardState;
      reason: AgreedJishogiCancellationRejectionReason;
      message: string;
    };

export type AgreedJishogiResponse = 'accept' | 'reject';

export type AgreedJishogiResponseRejectionReason =
  | 'game_already_ended'
  | 'agreed_jishogi_not_available'
  | 'proposal_mismatch'
  | 'responder_mismatch'
  | 'self_acceptance'
  | 'invalid_response'
  | 'invalid_point_distribution'
  | AgreedJishogiIneligibilityReason;

export type AgreedJishogiResponseResult =
  | {
      type: 'accepted';
      state: BoardState;
      evaluation: AgreedJishogiEvaluation;
      result: AgreedJishogiDrawGameResult | AgreedJishogiPointLossGameResult;
    }
  | {
      type: 'declined';
      state: BoardState;
      evaluation: AgreedJishogiEvaluation;
    }
  | {
      type: 'rejected';
      state: BoardState;
      evaluation: AgreedJishogiEvaluation;
      reason: AgreedJishogiResponseRejectionReason;
      message: string;
    };

const REASON_MESSAGES: Record<AgreedJishogiIneligibilityReason, string> = {
  game_not_in_progress: '対局中の局面ではありません。',
  sente_king_missing: '先手玉が盤上に存在しません。',
  gote_king_missing: '後手玉が盤上に存在しません。',
  no_king_in_enemy_camp: '先手玉・後手玉のどちらも敵陣3段目以内に入っていません。',
};

function opponentOf(player: Player): Player {
  return player === 'sente' ? 'gote' : 'sente';
}

export function getAgreedJishogiReasonMessage(
  reason: AgreedJishogiIneligibilityReason
): string {
  return REASON_MESSAGES[reason];
}

/** Scores every owned board piece and hand piece, regardless of board location. */
export function calculateAgreedJishogiPoints(
  state: BoardState,
  player: Player
): number {
  const hand = player === 'sente' ? state.senteHand : state.goteHand;
  let points = hand.reduce(
    (total, piece) =>
      piece.player === player ? total + getJishogiPiecePoints(piece) : total,
    0
  );

  for (const row of state.squares) {
    for (const square of row) {
      if (square.piece?.player === player) {
        points += getJishogiPiecePoints(square.piece);
      }
    }
  }
  return points;
}

export function determineAgreedJishogiOutcome(
  sentePoints: number,
  gotePoints: number
): AgreedJishogiOutcome {
  const senteHasEnough = sentePoints >= AGREED_JISHOGI_REQUIRED_POINTS;
  const goteHasEnough = gotePoints >= AGREED_JISHOGI_REQUIRED_POINTS;
  if (senteHasEnough && goteHasEnough) return { kind: 'draw' };
  if (!senteHasEnough && goteHasEnough) {
    return { kind: 'point_loss', winner: 'gote', loser: 'sente' };
  }
  if (senteHasEnough && !goteHasEnough) {
    return { kind: 'point_loss', winner: 'sente', loser: 'gote' };
  }
  return { kind: 'invalid_point_distribution' };
}

export function evaluateAgreedJishogi(
  state: BoardState,
  proposer: Player = state.turn
): AgreedJishogiEvaluation {
  const responder = opponentOf(proposer);
  const isGameInProgress = state.status === 'active' || state.status === 'check';
  const senteKingSquare = findKingSquare(state.squares, 'sente');
  const goteKingSquare = findKingSquare(state.squares, 'gote');
  const senteKingExists = senteKingSquare !== null;
  const goteKingExists = goteKingSquare !== null;
  const senteKingInEnemyCamp =
    senteKingSquare !== null && isInEnemyCamp('sente', senteKingSquare.row);
  const goteKingInEnemyCamp =
    goteKingSquare !== null && isInEnemyCamp('gote', goteKingSquare.row);
  const hasEnteringKing = senteKingInEnemyCamp || goteKingInEnemyCamp;
  const sentePoints = calculateAgreedJishogiPoints(state, 'sente');
  const gotePoints = calculateAgreedJishogiPoints(state, 'gote');
  const reasons: AgreedJishogiIneligibilityReason[] = [];
  if (!isGameInProgress) reasons.push('game_not_in_progress');
  if (!senteKingExists) reasons.push('sente_king_missing');
  if (!goteKingExists) reasons.push('gote_king_missing');
  if (senteKingExists && goteKingExists && !hasEnteringKing) {
    reasons.push('no_king_in_enemy_camp');
  }

  return {
    proposer,
    responder,
    isGameInProgress,
    senteKingExists,
    goteKingExists,
    senteKingInEnemyCamp,
    goteKingInEnemyCamp,
    hasEnteringKing,
    sentePoints,
    gotePoints,
    outcome: determineAgreedJishogiOutcome(sentePoints, gotePoints),
    reasons,
    canPropose: proposer === state.turn && reasons.length === 0,
  };
}

function proposalMatchesState(
  state: BoardState,
  proposal: AgreedJishogiProposal
): boolean {
  return (
    proposal.kind === 'agreed_jishogi_proposal' &&
    proposal.proposer === state.turn &&
    proposal.responder === opponentOf(proposal.proposer) &&
    proposal.positionKey === createPositionKey(state) &&
    proposal.moveNumber === state.moveNumber
  );
}

export function proposeAgreedJishogi(
  state: BoardState,
  proposer: Player = state.turn
): AgreedJishogiProposalResult {
  const evaluation = evaluateAgreedJishogi(state, proposer);
  if (state.status === 'ended') {
    return { type: 'rejected', state, evaluation, reason: 'game_already_ended', message: '対局は既に終局しています。' };
  }
  if (state.status !== 'active' && state.status !== 'check') {
    return { type: 'rejected', state, evaluation, reason: 'agreed_jishogi_not_available', message: '現在の対局状態では持将棋を提案できません。' };
  }
  if (proposer !== state.turn) {
    return { type: 'rejected', state, evaluation, reason: 'proposer_not_current_turn', message: '提案者は現在の手番側でなければなりません。' };
  }
  if (evaluation.reasons.length > 0) {
    const reason = evaluation.reasons[0];
    return { type: 'rejected', state, evaluation, reason, message: getAgreedJishogiReasonMessage(reason) };
  }

  return {
    type: 'proposed',
    state,
    evaluation,
    proposal: {
      kind: 'agreed_jishogi_proposal',
      proposer,
      responder: opponentOf(proposer),
      positionKey: createPositionKey(state),
      moveNumber: state.moveNumber,
      sentePoints: evaluation.sentePoints,
      gotePoints: evaluation.gotePoints,
    },
  };
}

export function cancelAgreedJishogiProposal(
  state: BoardState,
  proposal: AgreedJishogiProposal,
  actor: Player
): AgreedJishogiCancellationResult {
  if (!proposalMatchesState(state, proposal)) {
    return { type: 'rejected', state, reason: 'proposal_mismatch', message: '提案時の局面と現在の局面が一致しません。' };
  }
  if (actor !== proposal.proposer) {
    return { type: 'rejected', state, reason: 'only_proposer_can_cancel', message: '提案をキャンセルできるのは提案者だけです。' };
  }
  return { type: 'cancelled', state };
}

export function respondToAgreedJishogiProposal(
  state: BoardState,
  proposal: AgreedJishogiProposal,
  responder: Player,
  response: AgreedJishogiResponse
): AgreedJishogiResponseResult {
  const evaluation = evaluateAgreedJishogi(state, proposal.proposer);
  const reject = (reason: AgreedJishogiResponseRejectionReason, message: string): AgreedJishogiResponseResult => ({
    type: 'rejected', state, evaluation, reason, message,
  });

  if (state.status === 'ended') return reject('game_already_ended', '対局は既に終局しています。');
  if (state.status !== 'active' && state.status !== 'check') {
    return reject('agreed_jishogi_not_available', '現在の対局状態では持将棋へ応答できません。');
  }
  if (!proposalMatchesState(state, proposal)) {
    return reject('proposal_mismatch', '提案時の局面と現在の局面が一致しません。');
  }
  if (responder === proposal.proposer) {
    return reject('self_acceptance', '提案者自身は提案へ応答できません。');
  }
  if (responder !== proposal.responder) {
    return reject('responder_mismatch', '応答者が提案の相手側と一致しません。');
  }
  if (response !== 'accept' && response !== 'reject') {
    return reject('invalid_response', '応答は承諾または拒否でなければなりません。');
  }
  if (evaluation.reasons.length > 0) {
    const reason = evaluation.reasons[0];
    return reject(reason, getAgreedJishogiReasonMessage(reason));
  }
  if (response === 'reject') {
    return { type: 'declined', state, evaluation };
  }
  if (evaluation.outcome.kind === 'invalid_point_distribution') {
    return reject('invalid_point_distribution', '双方が24点未満のため、点数不足側を一意に確定できません。');
  }

  const result: AgreedJishogiDrawGameResult | AgreedJishogiPointLossGameResult =
    evaluation.outcome.kind === 'draw'
      ? {
          winner: null,
          loser: null,
          endReason: 'agreed_jishogi_draw',
          sentePoints: evaluation.sentePoints,
          gotePoints: evaluation.gotePoints,
          details: '合意による持将棋・無勝負',
        }
      : {
          winner: evaluation.outcome.winner,
          loser: evaluation.outcome.loser,
          endReason: 'agreed_jishogi_point_loss',
          sentePoints: evaluation.sentePoints,
          gotePoints: evaluation.gotePoints,
          details: `${evaluation.outcome.loser === 'sente' ? '先手' : '後手'}の点数不足による負け`,
        };

  return {
    type: 'accepted',
    state: { ...state, status: 'ended', result, moveLimitJishogi: null },
    evaluation,
    result,
  };
}
