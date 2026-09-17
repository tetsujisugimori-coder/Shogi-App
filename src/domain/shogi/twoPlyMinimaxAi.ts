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
import {
  DEFAULT_PIECE_SQUARE_VALUE_TABLE,
  evaluatePieceSquarePosition,
  type PieceSquareValueTable,
} from './pieceSquareEvaluation';
import { cloneBoardState } from './replay';
import {
  DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS,
  evaluateKingSafety,
  type KingSafetyEvaluationWeights,
} from './kingSafetyEvaluation';
import { evaluateUndefendedPieceSafety } from './undefendedPieceSafetyEvaluation';
import { createAttackCountMaps } from './attacks';

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
  /** The adopted leaf evaluation, or null when no action is selected. */
  evaluationBreakdown: SearchEvaluationBreakdown | null;
  rootLegalActionCount: number;
  visitedPositionCount: number;
  depth: typeof TWO_PLY_MINIMAX_SEARCH_DEPTH;
  elapsedMilliseconds: number;
  topCandidates: readonly TwoPlyMinimaxCandidate[];
}

export type SearchClock = () => number;

/** Optional, serializable evaluation tables for search experiments. */
export interface SearchEvaluationOptions {
  readonly materialValueTable?: MaterialValueTable;
  readonly pieceSquareValueTable?: PieceSquareValueTable;
  readonly kingSafetyWeights?: KingSafetyEvaluationWeights;
}

/** Retains the historical MaterialValueTable argument while allowing both tables as one option. */
export type SearchEvaluationConfig = MaterialValueTable | SearchEvaluationOptions;

/**
 * The terminal outcome and every finite term used to evaluate one search
 * position. This is plain serializable data so a future Worker boundary can
 * carry it without changing its representation.
 */
export interface SearchEvaluationBreakdown {
  readonly total: number;
  readonly material: number;
  readonly pieceSquare: number;
  readonly kingSafety: number;
  readonly undefendedPieceSafety: number;
  readonly terminal: 'win' | 'loss' | 'draw' | null;
}

function isMaterialValueTable(config: SearchEvaluationConfig): config is MaterialValueTable {
  return 'unpromoted' in config && 'promoted' in config;
}

function resolveSearchEvaluationOptions(config: SearchEvaluationConfig | undefined): Required<SearchEvaluationOptions> {
  if (config && isMaterialValueTable(config)) {
    return {
      materialValueTable: config,
      pieceSquareValueTable: DEFAULT_PIECE_SQUARE_VALUE_TABLE,
      kingSafetyWeights: DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS,
    };
  }
  return {
    materialValueTable: config?.materialValueTable ?? DEFAULT_MATERIAL_VALUE_TABLE,
    pieceSquareValueTable: config?.pieceSquareValueTable ?? DEFAULT_PIECE_SQUARE_VALUE_TABLE,
    kingSafetyWeights: config?.kingSafetyWeights ?? DEFAULT_KING_SAFETY_EVALUATION_WEIGHTS,
  };
}

function opponentOf(player: Player): Player {
  return player === 'sente' ? 'gote' : 'sente';
}

/**
 * Scores a position for search while making the recorded game result dominate
 * every finite material, position, King-safety, and undefended-piece safety
 * score. Draw results are neutral.
 *
 * An ended position must have a consistent result, and an in-progress
 * position must not have one. Throwing for malformed state prevents search
 * from silently treating a corrupted terminal position as ordinary material.
 */
export function evaluateSearchPositionBreakdown(
  state: BoardState,
  perspective: Player,
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE
): SearchEvaluationBreakdown {
  if (state.status === 'ended') {
    if (!state.result) {
      throw new Error('Ended search position must have a game result.');
    }

    const { winner, loser } = state.result;
    if (winner === null || loser === null) {
      if (winner !== null || loser !== null) {
        throw new Error('Draw search result must not name a winner or loser.');
      }
      return {
        total: 0,
        material: 0,
        pieceSquare: 0,
        kingSafety: 0,
        undefendedPieceSafety: 0,
        terminal: 'draw',
      };
    }

    if (winner === loser || loser !== opponentOf(winner)) {
      throw new Error('Decisive search result must name opposite winner and loser.');
    }
    const terminal = winner === perspective ? 'win' : 'loss';
    return {
      total: terminal === 'win' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      material: 0,
      pieceSquare: 0,
      kingSafety: 0,
      undefendedPieceSafety: 0,
      terminal,
    };
  }

  if (state.result) {
    throw new Error('Non-ended search position must not have a game result.');
  }
  if (state.status !== 'active' && state.status !== 'check') {
    throw new Error(`Search evaluation requires an active, check, or ended position; received ${state.status}.`);
  }
  const { materialValueTable, pieceSquareValueTable, kingSafetyWeights } = resolveSearchEvaluationOptions(evaluation);
  // Raw influence is useful to the static heuristics only. It is intentionally
  // rebuilt for this one position evaluation and is not used for legal moves,
  // check detection, or any cross-position cache.
  const attackCountMaps = createAttackCountMaps(state.squares);
  const material = evaluateMaterial(state, perspective, materialValueTable);
  const pieceSquare = evaluatePieceSquarePosition(state, perspective, pieceSquareValueTable);
  const kingSafety = evaluateKingSafety(state, perspective, kingSafetyWeights, attackCountMaps);
  const undefendedPieceSafety = evaluateUndefendedPieceSafety(
    state,
    perspective,
    materialValueTable,
    attackCountMaps
  );
  return {
    total: material + pieceSquare + kingSafety + undefendedPieceSafety,
    material,
    pieceSquare,
    kingSafety,
    undefendedPieceSafety,
    terminal: null,
  };
}

/**
 * Returns the total from the canonical search evaluation breakdown. The
 * historical numeric API remains unchanged for every caller and config form.
 */
export function evaluateSearchPosition(
  state: BoardState,
  perspective: Player,
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE
): number {
  return evaluateSearchPositionBreakdown(state, perspective, evaluation).total;
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
  evaluation: SearchEvaluationConfig
): UnmeasuredTwoPlyMinimaxSearchResult {
  const rootPlayer = state.turn;
  const rootActions = getLegalActions(state);
  let bestAction: LegalAction | null = null;
  let bestEvaluation = Number.NEGATIVE_INFINITY;
  let bestBreakdown: SearchEvaluationBreakdown | null = null;
  let visitedPositionCount = 0;
  const candidates: TwoPlyMinimaxCandidate[] = [];

  for (const rootAction of rootActions) {
    const afterRootAction = executeSearchAction(state, rootAction);
    visitedPositionCount += 1;
    let candidateBreakdown: SearchEvaluationBreakdown;

    if (afterRootAction.status === 'ended') {
      candidateBreakdown = evaluateSearchPositionBreakdown(afterRootAction, rootPlayer, evaluation);
    } else {
      const replies = getLegalActions(afterRootAction);
      if (replies.length === 0) {
        throw new Error('A non-ended search position has no legal opponent response.');
      }

      let worstReplyBreakdown: SearchEvaluationBreakdown | null = null;
      for (const reply of replies) {
        const afterReply = executeSearchAction(afterRootAction, reply);
        visitedPositionCount += 1;
        const replyBreakdown = evaluateSearchPositionBreakdown(afterReply, rootPlayer, evaluation);
        if (worstReplyBreakdown === null || replyBreakdown.total < worstReplyBreakdown.total) {
          worstReplyBreakdown = replyBreakdown;
        }
      }
      if (worstReplyBreakdown === null) throw new Error('No opponent reply was evaluated.');
      candidateBreakdown = worstReplyBreakdown;
    }

    const candidateEvaluation = candidateBreakdown.total;
    candidates.push({ action: rootAction, evaluation: candidateEvaluation });
    // The first legal action establishes the stable comparison baseline. Later
    // equal scores retain that action because this remains a strict comparison.
    if (bestAction === null || candidateEvaluation > bestEvaluation) {
      bestAction = rootAction;
      bestEvaluation = candidateEvaluation;
      bestBreakdown = candidateBreakdown;
    }
  }

  return {
    selectedAction: bestAction,
    selectedEvaluation: bestAction === null ? null : bestEvaluation,
    evaluationBreakdown: bestBreakdown,
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
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock
): TwoPlyMinimaxSearchResult {
  const startedAt = clock();
  const searchResult = searchTwoPlyMinimax(state, evaluation);
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
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE
): LegalAction | null {
  return searchTwoPlyMinimax(state, evaluation).selectedAction;
}
