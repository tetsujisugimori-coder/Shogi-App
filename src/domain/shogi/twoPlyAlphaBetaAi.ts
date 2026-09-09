/**
 * A fixed-depth, two-ply alpha-beta search built exclusively from the public
 * legal-action, execution, cloning, and material-evaluation domain APIs.
 */
import type { BoardState } from '../../types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
  type MaterialValueTable,
} from './materialEvaluation';
import { cloneBoardState } from './replay';
import { evaluateSearchPosition, type SearchClock } from './twoPlyMinimaxAi';

/** The fixed search depth used by the current two-ply alpha-beta AI. */
export const TWO_PLY_ALPHA_BETA_SEARCH_DEPTH = 2;

/**
 * Observations collected while choosing a two-ply alpha-beta action.
 *
 * Every evaluation is from the root AI player's perspective: larger values are
 * better for that player. `visitedPositionCount` counts each successor state
 * produced by applying an explored action; the root state itself is excluded.
 * `prunedRootCandidateCount` counts root candidates for which alpha caused at
 * least one remaining opponent reply to be skipped. `skippedOpponentReplyCount`
 * is the total number of those unexecuted remaining replies.
 */
export interface TwoPlyAlphaBetaSearchResult {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  rootLegalActionCount: number;
  visitedPositionCount: number;
  depth: typeof TWO_PLY_ALPHA_BETA_SEARCH_DEPTH;
  elapsedMilliseconds: number;
  prunedRootCandidateCount: number;
  skippedOpponentReplyCount: number;
}

function executeSearchAction(state: BoardState, action: LegalAction): BoardState {
  const execution = executeLegalAction(cloneBoardState(state), action);
  if (execution.type !== 'applied') {
    throw new Error('A generated legal action could not be executed during alpha-beta search.');
  }
  return execution.state;
}

type UnmeasuredTwoPlyAlphaBetaSearchResult = Omit<
  TwoPlyAlphaBetaSearchResult,
  'elapsedMilliseconds'
>;

/**
 * Runs the fixed-depth search once without taking a clock reading. Root actions
 * are maximized in legal-action order, while replies minimize the fixed root
 * player's evaluation. Once a reply makes a candidate no better than alpha,
 * remaining replies are not executed because the candidate cannot replace the
 * current best root action. A pruned candidate's exact final value is never
 * exposed or used as an exact candidate evaluation.
 */
function searchTwoPlyAlphaBeta(
  state: BoardState,
  valueTable: MaterialValueTable
): UnmeasuredTwoPlyAlphaBetaSearchResult {
  const rootPlayer = state.turn;
  const rootActions = getLegalActions(state);
  let bestAction: LegalAction | null = null;
  let bestEvaluation = Number.NEGATIVE_INFINITY;
  let visitedPositionCount = 0;
  let prunedRootCandidateCount = 0;
  let skippedOpponentReplyCount = 0;

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
      for (let replyIndex = 0; replyIndex < replies.length; replyIndex += 1) {
        const afterReply = executeSearchAction(afterRootAction, replies[replyIndex]);
        visitedPositionCount += 1;
        const replyEvaluation = evaluateSearchPosition(afterReply, rootPlayer, valueTable);
        if (replyEvaluation < worstReplyEvaluation) {
          worstReplyEvaluation = replyEvaluation;
        }

        const remainingReplyCount = replies.length - replyIndex - 1;
        if (worstReplyEvaluation <= bestEvaluation && remainingReplyCount > 0) {
          prunedRootCandidateCount += 1;
          skippedOpponentReplyCount += remainingReplyCount;
          break;
        }
      }
      candidateEvaluation = worstReplyEvaluation;
    }

    // `bestAction === null` preserves the existing -Infinity boundary: the
    // first legal root action is selected even when every candidate loses.
    // A cut-off candidate is known not to exceed `bestEvaluation`, so strict
    // comparison preserves the fixed root action order for ties.
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
    depth: TWO_PLY_ALPHA_BETA_SEARCH_DEPTH,
    prunedRootCandidateCount,
    skippedOpponentReplyCount,
  };
}

function defaultSearchClock(): number {
  return performance.now();
}

/**
 * Selects an action and returns measurements from that same alpha-beta search.
 * The elapsed time covers the whole search call; it remains outside the
 * deterministic search computation itself.
 */
export function analyzeTwoPlyAlphaBetaSearch(
  state: BoardState,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock
): TwoPlyAlphaBetaSearchResult {
  const startedAt = clock();
  const searchResult = searchTwoPlyAlphaBeta(state, valueTable);
  return {
    ...searchResult,
    elapsedMilliseconds: Math.max(0, clock() - startedAt),
  };
}

/**
 * Selects a move with the same fixed two-ply alpha-beta search used by the
 * analysis API. Selection itself never changes the supplied board state.
 */
export function selectBestTwoPlyAlphaBetaAction(
  state: BoardState,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): LegalAction | null {
  return searchTwoPlyAlphaBeta(state, valueTable).selectedAction;
}
