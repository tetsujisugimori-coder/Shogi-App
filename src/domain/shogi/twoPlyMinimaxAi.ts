/**
 * A fixed-depth, two-ply material search built exclusively from the public
 * legal-action, execution, cloning, and material-evaluation domain APIs.
 */
import type { BoardState, Player } from '../../types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
  evaluateMaterial,
  type MaterialValueTable,
} from './materialEvaluation';
import { cloneBoardState } from './replay';

function opponentOf(player: Player): Player {
  return player === 'sente' ? 'gote' : 'sente';
}

/**
 * Scores a position for search while making the recorded game result dominate
 * every finite material score. Draw results are neutral.
 *
 * An ended position must have a consistent result, and an in-progress
 * position must not have one. Throwing for malformed state prevents search
 * from silently treating a corrupted terminal position as ordinary material.
 */
export function evaluateSearchPosition(
  state: BoardState,
  perspective: Player,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): number {
  if (state.status === 'ended') {
    if (!state.result) {
      throw new Error('Ended search position must have a game result.');
    }

    const { winner, loser } = state.result;
    if (winner === null || loser === null) {
      if (winner !== null || loser !== null) {
        throw new Error('Draw search result must not name a winner or loser.');
      }
      return 0;
    }

    if (winner === loser || loser !== opponentOf(winner)) {
      throw new Error('Decisive search result must name opposite winner and loser.');
    }
    return winner === perspective ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }

  if (state.result) {
    throw new Error('Non-ended search position must not have a game result.');
  }
  if (state.status !== 'active' && state.status !== 'check') {
    throw new Error(`Search evaluation requires an active, check, or ended position; received ${state.status}.`);
  }
  return evaluateMaterial(state, perspective, valueTable);
}

function executeSearchAction(state: BoardState, action: LegalAction): BoardState {
  const execution = executeLegalAction(cloneBoardState(state), action);
  if (execution.type !== 'applied') {
    throw new Error('A generated legal action could not be executed during minimax search.');
  }
  return execution.state;
}

/**
 * Selects a move by searching the AI's move and every legal opponent reply.
 * The root player is fixed from the initial turn, the opponent minimizes that
 * player's score, and equal scores retain the first stable legal action.
 */
export function selectBestTwoPlyMinimaxAction(
  state: BoardState,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): LegalAction | null {
  const rootPlayer = state.turn;
  const rootActions = getLegalActions(state);
  let bestAction: LegalAction | null = null;
  let bestEvaluation = Number.NEGATIVE_INFINITY;

  for (const rootAction of rootActions) {
    const afterRootAction = executeSearchAction(state, rootAction);
    let candidateEvaluation: number;

    if (afterRootAction.status === 'ended') {
      candidateEvaluation = evaluateSearchPosition(afterRootAction, rootPlayer, valueTable);
    } else {
      const replies = getLegalActions(afterRootAction);
      if (replies.length === 0) {
        throw new Error('A non-ended search position has no legal opponent response.');
      }

      let worstReplyEvaluation = Number.POSITIVE_INFINITY;
      for (const reply of replies) {
        const afterReply = executeSearchAction(afterRootAction, reply);
        const replyEvaluation = evaluateSearchPosition(afterReply, rootPlayer, valueTable);
        if (replyEvaluation < worstReplyEvaluation) {
          worstReplyEvaluation = replyEvaluation;
        }
      }
      candidateEvaluation = worstReplyEvaluation;
    }

    if (bestAction === null || candidateEvaluation > bestEvaluation) {
      bestAction = rootAction;
      bestEvaluation = candidateEvaluation;
    }
  }

  return bestAction;
}
