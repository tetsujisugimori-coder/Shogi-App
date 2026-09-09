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

/** The fixed search depth used by the current two-ply minimax AI. */
export const TWO_PLY_MINIMAX_SEARCH_DEPTH = 2;

/** A root action and its score from the root (AI) player's perspective. */
export interface TwoPlyMinimaxCandidate {
  action: LegalAction;
  evaluation: number;
}

/**
 * Observations collected while choosing a two-ply minimax action.
 *
 * Every evaluation is from the root AI player's perspective: larger values are
 * better for that player. `visitedPositionCount` counts each successor state
 * produced by applying an explored action; the root state itself is excluded.
 */
export interface TwoPlyMinimaxSearchResult {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  rootLegalActionCount: number;
  visitedPositionCount: number;
  depth: typeof TWO_PLY_MINIMAX_SEARCH_DEPTH;
  elapsedMilliseconds: number;
  topCandidates: readonly TwoPlyMinimaxCandidate[];
}

export type SearchClock = () => number;

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

type UnmeasuredTwoPlyMinimaxSearchResult = Omit<TwoPlyMinimaxSearchResult, 'elapsedMilliseconds'>;

function compareCandidatesByEvaluation(
  left: TwoPlyMinimaxCandidate,
  right: TwoPlyMinimaxCandidate
): number {
  if (left.evaluation === right.evaluation) return 0;
  return right.evaluation > left.evaluation ? 1 : -1;
}

/**
 * Runs the fixed-depth search once without taking a clock reading. Keeping the
 * clock outside this function makes the minimax computation deterministic.
 */
function searchTwoPlyMinimax(
  state: BoardState,
  valueTable: MaterialValueTable
): UnmeasuredTwoPlyMinimaxSearchResult {
  const rootPlayer = state.turn;
  const rootActions = getLegalActions(state);
  let bestAction: LegalAction | null = null;
  let bestEvaluation = Number.NEGATIVE_INFINITY;
  let visitedPositionCount = 0;
  const candidates: TwoPlyMinimaxCandidate[] = [];

  for (const rootAction of rootActions) {
    const afterRootAction = executeSearchAction(state, rootAction);
    visitedPositionCount += 1;
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
        visitedPositionCount += 1;
        const replyEvaluation = evaluateSearchPosition(afterReply, rootPlayer, valueTable);
        if (replyEvaluation < worstReplyEvaluation) {
          worstReplyEvaluation = replyEvaluation;
        }
      }
      candidateEvaluation = worstReplyEvaluation;
    }

    candidates.push({ action: rootAction, evaluation: candidateEvaluation });
    // The first legal action establishes the stable comparison baseline. Later
    // equal scores retain that action because this remains a strict comparison.
    if (bestAction === null || candidateEvaluation > bestEvaluation) {
      bestAction = rootAction;
      bestEvaluation = candidateEvaluation;
    }
  }

  return {
    selectedAction: bestAction,
    selectedEvaluation: bestAction === null ? null : bestEvaluation,
    rootLegalActionCount: rootActions.length,
    visitedPositionCount,
    depth: TWO_PLY_MINIMAX_SEARCH_DEPTH,
    topCandidates: candidates.slice().sort(compareCandidatesByEvaluation).slice(0, 3),
  };
}

function defaultSearchClock(): number {
  return performance.now();
}

/**
 * Selects an action and returns the measurements gathered by that same search.
 * The elapsed time covers the whole search call; it is intentionally excluded
 * from the deterministic minimax computation itself.
 */
export function analyzeTwoPlyMinimaxSearch(
  state: BoardState,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock
): TwoPlyMinimaxSearchResult {
  const startedAt = clock();
  const searchResult = searchTwoPlyMinimax(state, valueTable);
  return {
    ...searchResult,
    elapsedMilliseconds: Math.max(0, clock() - startedAt),
  };
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
  return searchTwoPlyMinimax(state, valueTable).selectedAction;
}
