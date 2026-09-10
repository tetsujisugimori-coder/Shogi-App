/**
 * A depth-configurable alpha-beta search built exclusively from the public
 * legal-action, execution, cloning, and material-evaluation domain APIs.
 */
import type { BoardState, Player } from '../../types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
  type MaterialValueTable,
} from './materialEvaluation';
import { cloneBoardState } from './replay';
import { evaluateSearchPosition, type SearchClock } from './twoPlyMinimaxAi';

/** The existing AI entry point remains a two-ply search by default. */
export const TWO_PLY_ALPHA_BETA_SEARCH_DEPTH = 2;

/**
 * Observations collected while choosing an action with alpha-beta search.
 *
 * Every evaluation is from the root AI player's perspective: larger values are
 * better for that player. `visitedPositionCount` counts successor states made
 * by applying explored actions; the supplied root state is excluded.
 * `cutoffCount` counts loops actually stopped by `alpha >= beta`, and
 * `skippedActionCount` counts the unexecuted actions left in those loops.
 */
export interface AlphaBetaSearchResult {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  rootLegalActionCount: number;
  visitedPositionCount: number;
  depth: number;
  elapsedMilliseconds: number;
  cutoffCount: number;
  skippedActionCount: number;
}

/** Backward-compatible measurements for the established two-ply API. */
export interface TwoPlyAlphaBetaSearchResult {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  rootLegalActionCount: number;
  visitedPositionCount: number;
  depth: typeof TWO_PLY_ALPHA_BETA_SEARCH_DEPTH;
  elapsedMilliseconds: number;
  /** At depth 2 this is exactly the number of cut-off opponent-reply loops. */
  prunedRootCandidateCount: number;
  /** At depth 2 this is exactly the number of skipped opponent replies. */
  skippedOpponentReplyCount: number;
}

interface SearchStatistics {
  visitedPositionCount: number;
  cutoffCount: number;
  skippedActionCount: number;
}

function executeSearchAction(state: BoardState, action: LegalAction): BoardState {
  const execution = executeLegalAction(cloneBoardState(state), action);
  if (execution.type !== 'applied') {
    throw new Error('A generated legal action could not be executed during alpha-beta search.');
  }
  return execution.state;
}

function validateSearchDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error('Alpha-beta search depth must be a non-negative integer measured in ply.');
  }
}

/**
 * Returns a new, deterministic order for actions at non-root alpha-beta
 * nodes. Captures and promotions are classified from the current position;
 * no child state is created merely to order an action.
 *
 * This is intentionally not used for root actions. The root keeps the public
 * legal-action order so strict root tie handling remains backward compatible.
 */
export function orderAlphaBetaNodeActions(
  state: BoardState,
  actions: readonly LegalAction[]
): LegalAction[] {
  const priorityOf = (action: LegalAction): number => {
    const target = action.kind === 'move'
      ? state.squares[action.to.row][action.to.col].piece
      : null;
    const isCapture = action.kind === 'move' && target !== null && target.player !== action.player;
    const isPromotion = action.kind === 'move' && action.promotion === 'promote';

    if (isCapture && isPromotion) return 0;
    if (isCapture) return 1;
    if (isPromotion) return 2;
    return 3;
  };

  return actions
    .map((action, originalIndex) => ({ action, originalIndex, priority: priorityOf(action) }))
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex)
    .map(({ action }) => action);
}

/**
 * Evaluates one non-root search node. `remainingDepth` is the number of plies
 * still available from this node, so the root action has already consumed one
 * ply before this function is first called.
 */
function searchAlphaBetaNode(
  state: BoardState,
  remainingDepth: number,
  rootPlayer: Player,
  isMaximizing: boolean,
  alpha: number,
  beta: number,
  valueTable: MaterialValueTable,
  statistics: SearchStatistics
): number {
  if (state.status === 'ended' || remainingDepth === 0) {
    return evaluateSearchPosition(state, rootPlayer, valueTable);
  }

  const actions = orderAlphaBetaNodeActions(state, getLegalActions(state));
  // All reachable no-legal-action positions are marked ended by the existing
  // rules. Treat a malformed in-progress position as a leaf as well, rather
  // than recursing forever or throwing after a valid API result of [].
  if (actions.length === 0) {
    return evaluateSearchPosition(state, rootPlayer, valueTable);
  }

  let value = isMaximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const child = executeSearchAction(state, actions[actionIndex]);
    statistics.visitedPositionCount += 1;
    const childValue = searchAlphaBetaNode(
      child,
      remainingDepth - 1,
      rootPlayer,
      !isMaximizing,
      alpha,
      beta,
      valueTable,
      statistics
    );

    if (isMaximizing) {
      if (childValue > value) value = childValue;
      if (value > alpha) alpha = value;
    } else {
      if (childValue < value) value = childValue;
      if (value < beta) beta = value;
    }

    const remainingActionCount = actions.length - actionIndex - 1;
    if (alpha >= beta && remainingActionCount > 0) {
      statistics.cutoffCount += 1;
      statistics.skippedActionCount += remainingActionCount;
      break;
    }
  }
  return value;
}

type UnmeasuredAlphaBetaSearchResult = Omit<AlphaBetaSearchResult, 'elapsedMilliseconds'>;

/**
 * Runs a root action search without clock reads. External `depth` includes the
 * root action: depth 1 evaluates each root successor, depth 2 also searches
 * one opponent reply, and depth 3 searches root/opponent/root.
 */
function searchAlphaBeta(
  state: BoardState,
  depth: number,
  valueTable: MaterialValueTable
): UnmeasuredAlphaBetaSearchResult {
  validateSearchDepth(depth);
  const rootPlayer = state.turn;
  const statistics: SearchStatistics = {
    visitedPositionCount: 0,
    cutoffCount: 0,
    skippedActionCount: 0,
  };

  if (depth === 0) {
    return {
      selectedAction: null,
      selectedEvaluation: evaluateSearchPosition(state, rootPlayer, valueTable),
      rootLegalActionCount: 0,
      depth,
      ...statistics,
    };
  }

  const rootActions = getLegalActions(state);
  let bestAction: LegalAction | null = null;
  let bestEvaluation = Number.NEGATIVE_INFINITY;
  let alpha = Number.NEGATIVE_INFINITY;
  const beta = Number.POSITIVE_INFINITY;

  for (const rootAction of rootActions) {
    const afterRootAction = executeSearchAction(state, rootAction);
    statistics.visitedPositionCount += 1;
    const candidateEvaluation = searchAlphaBetaNode(
      afterRootAction,
      depth - 1,
      rootPlayer,
      false,
      alpha,
      beta,
      valueTable,
      statistics
    );

    // The first legal action establishes the baseline even at -Infinity. The
    // strict comparison preserves fixed legal-action order when values tie.
    if (bestAction === null || candidateEvaluation > bestEvaluation) {
      bestAction = rootAction;
      bestEvaluation = candidateEvaluation;
    }
    if (bestEvaluation > alpha) alpha = bestEvaluation;
  }

  return {
    selectedAction: bestAction,
    selectedEvaluation: bestAction === null ? null : bestEvaluation,
    rootLegalActionCount: rootActions.length,
    depth,
    ...statistics,
  };
}

function defaultSearchClock(): number {
  return performance.now();
}

/**
 * Selects an action using recursive alpha-beta search at a ply depth supplied
 * by the caller. The input board state is never mutated.
 */
export function analyzeAlphaBetaSearch(
  state: BoardState,
  depth: number,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock
): AlphaBetaSearchResult {
  const startedAt = clock();
  const searchResult = searchAlphaBeta(state, depth, valueTable);
  return {
    ...searchResult,
    elapsedMilliseconds: Math.max(0, clock() - startedAt),
  };
}

/** Selects only the best action from the requested recursive search depth. */
export function selectBestAlphaBetaAction(
  state: BoardState,
  depth: number,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): LegalAction | null {
  return searchAlphaBeta(state, depth, valueTable).selectedAction;
}

/**
 * Compatibility entry point for callers that still request the old two-ply
 * alpha-beta API. It delegates to the one recursive implementation; no fixed
 * two-ply search body remains in production code.
 */
export function analyzeTwoPlyAlphaBetaSearch(
  state: BoardState,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock
): TwoPlyAlphaBetaSearchResult {
  const result = analyzeAlphaBetaSearch(state, TWO_PLY_ALPHA_BETA_SEARCH_DEPTH, valueTable, clock);
  return {
    selectedAction: result.selectedAction,
    selectedEvaluation: result.selectedEvaluation,
    rootLegalActionCount: result.rootLegalActionCount,
    visitedPositionCount: result.visitedPositionCount,
    depth: TWO_PLY_ALPHA_BETA_SEARCH_DEPTH,
    elapsedMilliseconds: result.elapsedMilliseconds,
    prunedRootCandidateCount: result.cutoffCount,
    skippedOpponentReplyCount: result.skippedActionCount,
  };
}

/** Compatibility selector that preserves the established default depth of 2. */
export function selectBestTwoPlyAlphaBetaAction(
  state: BoardState,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): LegalAction | null {
  return selectBestAlphaBetaAction(state, TWO_PLY_ALPHA_BETA_SEARCH_DEPTH, valueTable);
}
