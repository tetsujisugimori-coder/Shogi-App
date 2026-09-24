/**
 * A depth-configurable alpha-beta search built exclusively from the public
 * legal-action, execution, cloning, and material-evaluation domain APIs.
 */
import type { BoardState, Player } from '../../types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
} from './materialEvaluation';
import { analyzeQuiescenceSearchWithinBounds } from './quiescenceSearch';
import { resolveQuiescenceMoveOrdering, type QuiescenceMoveOrderingMode } from './quiescenceOrdering';
import { prepareStaticExchangeEvaluation } from './staticExchangeEvaluation';
import { measured, type SearchDiagnostics } from './searchDiagnostics';
import {
  evaluateSearchPositionBreakdown,
  resolveSearchMaterialValueTable,
  type SearchClock,
  type SearchEvaluationConfig,
  type SearchEvaluationBreakdown,
} from './twoPlyMinimaxAi';

/** The existing AI entry point remains a two-ply search by default. */
export const TWO_PLY_ALPHA_BETA_SEARCH_DEPTH = 2;

/** Search order is independent of evaluation weights and presets. */
export type AlphaBetaMoveOrderingMode = 'standard' | 'static-exchange';

/** Explicit opt-in tactical extension at ordinary alpha-beta leaves. */
export interface AlphaBetaQuiescenceOptions {
  readonly maxTacticalDepth: number;
  /** Omitted retains legal generation order. Independent of ordinary moveOrdering. */
  readonly moveOrdering?: QuiescenceMoveOrderingMode;
}

/** Optional trailing configuration; existing callers keep standard ordering. */
export interface AlphaBetaSearchOptions {
  readonly moveOrdering?: AlphaBetaMoveOrderingMode;
  /** Opt-in non-capture cutoff history. Omitted preserves the historical order. */
  readonly killerMoves?: boolean;
  /** Omit to retain the historical static evaluation at depth-zero leaves. */
  readonly quiescence?: AlphaBetaQuiescenceOptions;
}

function resolveMoveOrdering(options: AlphaBetaSearchOptions | undefined): AlphaBetaMoveOrderingMode {
  const mode = options?.moveOrdering;
  if (mode === undefined) return 'standard';
  if (mode === 'standard' || mode === 'static-exchange') return mode;
  throw new RangeError(`Unsupported alpha-beta move ordering mode: ${String(mode)}`);
}

function resolveKillerMoves(options: AlphaBetaSearchOptions | undefined): boolean {
  const enabled = options?.killerMoves;
  if (enabled === undefined) return false;
  if (typeof enabled === 'boolean') return enabled;
  throw new RangeError(`Alpha-beta killerMoves must be a boolean: ${String(enabled)}`);
}

function resolveQuiescenceOptions(options: AlphaBetaSearchOptions | undefined): AlphaBetaQuiescenceOptions | undefined {
  const quiescence = options?.quiescence;
  if (quiescence === undefined) return undefined;
  if (quiescence === null || typeof quiescence !== 'object' || Array.isArray(quiescence) ||
    Reflect.ownKeys(quiescence).some((key) => key !== 'maxTacticalDepth' && key !== 'moveOrdering')) {
    throw new RangeError('Alpha-beta quiescence options must contain only maxTacticalDepth and optional moveOrdering.');
  }
  const maxTacticalDepth = (quiescence as AlphaBetaQuiescenceOptions).maxTacticalDepth;
  if (typeof maxTacticalDepth !== 'number' || !Number.isFinite(maxTacticalDepth) ||
    !Number.isInteger(maxTacticalDepth) || maxTacticalDepth < 0) {
    throw new RangeError('Alpha-beta quiescence maximum tactical depth must be a finite non-negative integer measured in ply.');
  }
  return { maxTacticalDepth, moveOrdering: resolveQuiescenceMoveOrdering(quiescence.moveOrdering) };
}

/**
 * Observations collected while choosing an action with alpha-beta search.
 *
 * Every evaluation is from the root AI player's perspective: larger values are
 * better for that player. `visitedPositionCount` counts successor states made
 * by applying explored actions; the supplied root state is excluded.
 * `cutoffCount` counts loops actually stopped by `alpha >= beta`, and
 * `skippedActionCount` counts the unexecuted actions left in those loops.
 * Those established fields describe ordinary alpha-beta only. The
 * `quiescence*` fields separately describe opt-in tactical leaf work.
 * When quiescence is enabled, the PV may be longer than `depth`.
 */
export interface AlphaBetaSearchResult {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  /** The explored best line, starting with `selectedAction` when present. */
  principalVariation: LegalAction[];
  /**
   * Evaluation of the leaf reached by `principalVariation`, from the root
   * player's perspective. It is carried from the evaluated search leaf rather
   * than recomputed by replaying the variation after the search.
   */
  evaluationBreakdown: SearchEvaluationBreakdown;
  rootLegalActionCount: number;
  visitedPositionCount: number;
  depth: number;
  elapsedMilliseconds: number;
  cutoffCount: number;
  skippedActionCount: number;
  quiescenceLeafCount: number;
  quiescenceVisitedPositionCount: number;
  quiescenceCutoffCount: number;
  quiescenceSkippedActionCount: number;
}

/** One completed fixed-depth pass of iterative-deepening alpha-beta search. */
export interface IterativeDeepeningAlphaBetaIterationResult extends AlphaBetaSearchResult {}

/**
 * The deepest completed result plus every completed shallower iteration.
 *
 * The inherited search statistics describe only the deepest iteration. The
 * `total*` fields are sums across `iterations`, so callers can distinguish a
 * fixed-depth measurement from the work spent reaching that depth.
 */
export interface IterativeDeepeningAlphaBetaSearchResult extends AlphaBetaSearchResult {
  iterations: readonly IterativeDeepeningAlphaBetaIterationResult[];
  totalVisitedPositionCount: number;
  totalCutoffCount: number;
  totalSkippedActionCount: number;
  totalQuiescenceLeafCount: number;
  totalQuiescenceVisitedPositionCount: number;
  totalQuiescenceCutoffCount: number;
  totalQuiescenceSkippedActionCount: number;
}

/**
 * A time-limited iterative-deepening result. `completedDepth` and the
 * inherited fixed-depth fields always describe the last fully completed pass.
 * The top-level elapsed time includes work discarded from an interrupted pass.
 */
export interface TimeLimitedIterativeDeepeningAlphaBetaSearchResult
  extends Omit<IterativeDeepeningAlphaBetaSearchResult, 'evaluationBreakdown'> {
  /** Null only when no iteration completed; no leaf was evaluated for the fallback. */
  evaluationBreakdown: SearchEvaluationBreakdown | null;
  requestedMaxDepth: number;
  /** Zero means no iteration completed. */
  completedDepth: number;
  /** True when the deadline interrupted or prevented a requested iteration. */
  timedOut: boolean;
  resultSource: 'completed-iteration' | 'fallback';
}

/** Backward-compatible measurements for the established two-ply API. */
export interface TwoPlyAlphaBetaSearchResult {
  selectedAction: LegalAction | null;
  selectedEvaluation: number | null;
  principalVariation: LegalAction[];
  evaluationBreakdown: SearchEvaluationBreakdown;
  rootLegalActionCount: number;
  visitedPositionCount: number;
  depth: typeof TWO_PLY_ALPHA_BETA_SEARCH_DEPTH;
  elapsedMilliseconds: number;
  /** At depth 2 this is exactly the number of cut-off opponent-reply loops. */
  prunedRootCandidateCount: number;
  /** At depth 2 this is exactly the number of skipped opponent replies. */
  skippedOpponentReplyCount: number;
  quiescenceLeafCount: number;
  quiescenceVisitedPositionCount: number;
  quiescenceCutoffCount: number;
  quiescenceSkippedActionCount: number;
}

interface SearchStatistics {
  visitedPositionCount: number;
  cutoffCount: number;
  skippedActionCount: number;
  quiescenceLeafCount: number;
  quiescenceVisitedPositionCount: number;
  quiescenceCutoffCount: number;
  quiescenceSkippedActionCount: number;
}

function executeSearchAction(state: BoardState, action: LegalAction): BoardState {
  // The public executor validates the action and constructs a new state. Its
  // move/drop paths never mutate the supplied state, so cloning the entire
  // replay history first only duplicates work for every searched successor.
  const execution = executeLegalAction(state, action);
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

function validateIterativeDeepeningMaxDepth(maxDepth: number): void {
  validateSearchDepth(maxDepth);
  if (maxDepth === 0) {
    throw new Error('Iterative-deepening maximum depth must be a positive integer measured in ply.');
  }
}

function validateSearchTimeLimitMilliseconds(timeLimitMilliseconds: number): void {
  if (!Number.isFinite(timeLimitMilliseconds) || timeLimitMilliseconds < 0) {
    throw new Error('Alpha-beta search time limit must be a finite non-negative number of milliseconds.');
  }
}

/** An internal-only signal that discards one incomplete iterative pass. */
class SearchDeadlineExceeded extends Error {
  constructor() {
    super('Alpha-beta search deadline exceeded.');
    this.name = 'SearchDeadlineExceeded';
  }
}

type SearchInterruptionCheck = (() => void) | undefined;

function throwIfSearchTimeLimitReachedAt(
  observedAt: number,
  startedAt: number,
  timeLimitMilliseconds: number
): void {
  if (observedAt - startedAt >= timeLimitMilliseconds) throw new SearchDeadlineExceeded();
}

function sameCoordinate(
  left: { row: number; col: number },
  right: { row: number; col: number }
): boolean {
  return left.row === right.row && left.col === right.col;
}

/** Compares the meaningful fields of two legal actions without serializing them. */
export function areLegalActionsEqual(left: LegalAction, right: LegalAction): boolean {
  if (left.kind !== right.kind || left.player !== right.player || left.pieceType !== right.pieceType ||
    left.promotion !== right.promotion || !sameCoordinate(left.to, right.to)) {
    return false;
  }

  return left.kind === 'move' && right.kind === 'move'
    ? sameCoordinate(left.from, right.from)
    : left.kind === 'drop' && right.kind === 'drop' && left.pieceId === right.pieceId;
}

function cloneLegalAction(action: LegalAction): LegalAction {
  if (action.kind === 'move') {
    return {
      ...action,
      from: { ...action.from },
      to: { ...action.to },
    };
  }

  return { ...action, to: { ...action.to } };
}

/**
 * Search-local non-capture cutoff history, keyed by ply from the root.
 *
 * It is deliberately created by each public search context rather than kept
 * globally. Iterative passes share one instance; independent calls cannot.
 */
export class KillerMoveHistory {
  private readonly actionsByPly = new Map<number, readonly LegalAction[]>();

  actionsAt(ply: number): readonly LegalAction[] {
    return this.actionsByPly.get(ply) ?? [];
  }

  record(state: BoardState, ply: number, action: LegalAction): void {
    if (!isAlphaBetaQuietAction(state, action)) return;
    const previous = this.actionsAt(ply).filter((candidate) => !areLegalActionsEqual(candidate, action));
    this.actionsByPly.set(ply, [cloneLegalAction(action), ...previous].slice(0, 2));
  }
}

/**
 * Ordinary alpha-beta already gives promotions their own tactical tier. A
 * quiet move is consequently a non-capture, non-promoting board move or a
 * drop. Checks need no special detection here: checking quiet moves and
 * checking drops remain eligible just like other moves in that existing tier.
 */
export function isAlphaBetaQuietAction(state: BoardState, action: LegalAction): boolean {
  if (action.kind === 'drop') return true;
  const target = state.squares[action.to.row][action.to.col].piece;
  return (target === null || target.player === action.player) && action.promotion !== 'promote';
}

function clonePrincipalVariation(actions: readonly LegalAction[]): LegalAction[] {
  return actions.map(cloneLegalAction);
}

function cloneSearchEvaluationBreakdown(
  evaluationBreakdown: SearchEvaluationBreakdown
): SearchEvaluationBreakdown {
  return { ...evaluationBreakdown };
}

/**
 * Returns a new, deterministic order for actions at non-root alpha-beta
 * nodes. Standard uses capture+promotion, capture, promotion, other, without SEE.
 * Explicit static-exchange orders competing captures by moving-side SEE.
 * Negative exchanges remain candidates; neither mode changes leaf evaluations.
 *
 * Fixed-depth roots keep public legal-action order. Iterative roots use this
 * only after the previous best action; root ties still use original indexes.
 */
export function orderAlphaBetaNodeActions(
  state: BoardState,
  actions: readonly LegalAction[],
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  interruptionCheck: SearchInterruptionCheck = undefined,
  options?: AlphaBetaSearchOptions,
  killerMoves: readonly LegalAction[] = []
): LegalAction[] {
  return orderAlphaBetaNodeActionsByMode(state, actions, evaluation, interruptionCheck, resolveMoveOrdering(options), killerMoves);
}

function orderAlphaBetaNodeActionsByMode(
  state: BoardState,
  actions: readonly LegalAction[],
  evaluation: SearchEvaluationConfig,
  interruptionCheck: SearchInterruptionCheck,
  moveOrdering: AlphaBetaMoveOrderingMode,
  killerMoves: readonly LegalAction[] = [],
  diagnostics?: SearchDiagnostics
): LegalAction[] {
  const killerRank = (action: LegalAction): number => {
    if (!isAlphaBetaQuietAction(state, action)) return 2;
    const index = killerMoves.findIndex((candidate) => areLegalActionsEqual(candidate, action));
    return index === -1 ? 2 : index;
  };
  if (moveOrdering === 'standard') {
    // Keep the pre-SEE main ordering, including promotion priority and stable
    // indexes. This path never resolves a SEE table or prepares a child state.
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
      .map((action, originalIndex) => ({ action, originalIndex, priority: priorityOf(action), killer: killerRank(action) }))
      .sort((left, right) => left.priority - right.priority || left.killer - right.killer || left.originalIndex - right.originalIndex)
      .map(({ action }) => action);
  }
  const classified = actions.map((action, originalIndex) => {
    const target = action.kind === 'move'
      ? state.squares[action.to.row][action.to.col].piece
      : null;
    const isCapture = action.kind === 'move' && target !== null && target.player !== action.player;
    const isPromotion = action.kind === 'move' && action.promotion === 'promote';

    return { action, originalIndex, priority: isCapture ? 0 : isPromotion ? 1 : 2, exchange: 0, killer: killerRank(action) };
  });
  const captures = classified.filter(({ priority }) => priority === 0);
  // With no competing capture, SEE cannot affect the order. In particular,
  // iterative roots reach this point after removing the previous best action.
  if (captures.length >= 2) {
    const materialValueTable = resolveSearchMaterialValueTable(evaluation);
    let evaluateCapture: ReturnType<typeof prepareStaticExchangeEvaluation> | undefined;
    for (const candidate of captures) {
      interruptionCheck?.();
      evaluateCapture ??= measured(diagnostics, 'see', () => prepareStaticExchangeEvaluation(state, materialValueTable));
      const score = measured(diagnostics, 'see', () => evaluateCapture!(candidate.action));
      if (score === null) {
        throw new Error('Alpha-beta capture ordering contract violated: legal capture returned null SEE.');
      }
      interruptionCheck?.();
      candidate.exchange = score;
    }
  }
  return classified
    .sort((left, right) => left.priority - right.priority ||
      right.exchange - left.exchange || left.killer - right.killer || left.originalIndex - right.originalIndex)
    .map(({ action }) => action);
}

/**
 * Moves the completed previous iteration's best root action to the front.
 * Remaining root candidates use the selected move-ordering mode. If
 * that action is no longer legal, the public root legal-action order is kept.
 */
export function orderIterativeDeepeningRootActions(
  state: BoardState,
  actions: readonly LegalAction[],
  previousBestAction: LegalAction | null,
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  interruptionCheck: SearchInterruptionCheck = undefined,
  options?: AlphaBetaSearchOptions
): LegalAction[] {
  return orderIterativeDeepeningRootActionsByMode(
    state, actions, previousBestAction, evaluation, interruptionCheck, resolveMoveOrdering(options)
  );
}

function orderIterativeDeepeningRootActionsByMode(
  state: BoardState,
  actions: readonly LegalAction[],
  previousBestAction: LegalAction | null,
  evaluation: SearchEvaluationConfig,
  interruptionCheck: SearchInterruptionCheck,
  moveOrdering: AlphaBetaMoveOrderingMode,
  diagnostics?: SearchDiagnostics
): LegalAction[] {
  if (previousBestAction === null) return [...actions];

  const previousBestIndex = actions.findIndex((action) => areLegalActionsEqual(action, previousBestAction));
  if (previousBestIndex === -1) return [...actions];

  const previousBest = actions[previousBestIndex];
  const remainingActions = actions.filter((_, index) => index !== previousBestIndex);
  return [previousBest, ...orderAlphaBetaNodeActionsByMode(state, remainingActions, evaluation, interruptionCheck, moveOrdering, [], diagnostics)];
}

/**
 * Evaluates one non-root search node. `remainingDepth` is the number of plies
 * still available from this node, so the root action has already consumed one
 * ply before this function is first called.
 */
interface SearchNodeResult {
  evaluation: number;
  principalVariation: LegalAction[];
  evaluationBreakdown: SearchEvaluationBreakdown;
}

function searchAlphaBetaNode(
  state: BoardState,
  remainingDepth: number,
  rootPlayer: Player,
  isMaximizing: boolean,
  alpha: number,
  beta: number,
  valueTable: SearchEvaluationConfig,
  statistics: SearchStatistics,
  interruptionCheck: SearchInterruptionCheck,
  moveOrdering: AlphaBetaMoveOrderingMode,
  quiescenceOptions: AlphaBetaQuiescenceOptions | undefined,
  killerMoveHistory: KillerMoveHistory | undefined,
  ply: number,
  diagnostics?: SearchDiagnostics
): SearchNodeResult {
  interruptionCheck?.();
  if (state.status === 'ended') {
    const evaluationBreakdown = evaluateSearchPositionBreakdown(state, rootPlayer, valueTable);
    return {
      evaluation: evaluationBreakdown.total,
      principalVariation: [],
      evaluationBreakdown,
    };
  }
  if (remainingDepth === 0) {
    if (quiescenceOptions === undefined) {
      const evaluationBreakdown = evaluateSearchPositionBreakdown(state, rootPlayer, valueTable);
      return { evaluation: evaluationBreakdown.total, principalVariation: [], evaluationBreakdown };
    }
    statistics.quiescenceLeafCount += 1;
    const quiescence = measured(diagnostics, 'quiescence', () => analyzeQuiescenceSearchWithinBounds(
      state, rootPlayer, quiescenceOptions.maxTacticalDepth, valueTable, interruptionCheck, alpha, beta,
      quiescenceOptions.moveOrdering,
      diagnostics
    ));
    statistics.quiescenceVisitedPositionCount += quiescence.visitedPositionCount;
    statistics.quiescenceCutoffCount += quiescence.cutoffCount;
    statistics.quiescenceSkippedActionCount += quiescence.skippedActionCount;
    return {
      evaluation: quiescence.selectedEvaluation,
      principalVariation: clonePrincipalVariation(quiescence.principalVariation),
      evaluationBreakdown: cloneSearchEvaluationBreakdown(quiescence.evaluationBreakdown),
    };
  }

  const legalActions = measured(diagnostics, 'normal-legal', () => getLegalActions(state));
  const actions = measured(diagnostics, 'normal-order', () => orderAlphaBetaNodeActionsByMode(
    state, legalActions, valueTable, interruptionCheck, moveOrdering, killerMoveHistory?.actionsAt(ply), diagnostics
  ));
  // All reachable no-legal-action positions are marked ended by the existing
  // rules. Treat a malformed in-progress position as a leaf as well, rather
  // than recursing forever or throwing after a valid API result of [].
  if (actions.length === 0) {
    const evaluationBreakdown = evaluateSearchPositionBreakdown(state, rootPlayer, valueTable);
    return {
      evaluation: evaluationBreakdown.total,
      principalVariation: [],
      evaluationBreakdown,
    };
  }

  let value = isMaximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let principalVariation: LegalAction[] = [];
  let evaluationBreakdown: SearchEvaluationBreakdown | null = null;
  let hasExploredAction = false;
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    interruptionCheck?.();
    const child = measured(diagnostics, 'normal-execute', () => executeSearchAction(state, actions[actionIndex]));
    statistics.visitedPositionCount += 1;
    const childResult = searchAlphaBetaNode(
      child,
      remainingDepth - 1,
      rootPlayer,
      !isMaximizing,
      alpha,
      beta,
      valueTable,
      statistics,
      interruptionCheck,
      moveOrdering,
      quiescenceOptions,
      killerMoveHistory,
      ply + 1,
      diagnostics
    );

    const candidatePrincipalVariation = [
      cloneLegalAction(actions[actionIndex]),
      ...clonePrincipalVariation(childResult.principalVariation),
    ];
    const adoptsCandidate = !hasExploredAction || (isMaximizing
      ? childResult.evaluation > value
      : childResult.evaluation < value);
    if (adoptsCandidate) {
      value = childResult.evaluation;
      principalVariation = candidatePrincipalVariation;
      evaluationBreakdown = childResult.evaluationBreakdown;
    }
    hasExploredAction = true;

    if (isMaximizing) {
      if (value > alpha) alpha = value;
    } else {
      if (value < beta) beta = value;
    }

    const remainingActionCount = actions.length - actionIndex - 1;
    if (alpha >= beta && remainingActionCount > 0) {
      killerMoveHistory?.record(state, ply, actions[actionIndex]);
      statistics.cutoffCount += 1;
      statistics.skippedActionCount += remainingActionCount;
      break;
    }
  }
  if (evaluationBreakdown === null) {
    throw new Error('Alpha-beta search explored no actions at a non-leaf node.');
  }
  return { evaluation: value, principalVariation, evaluationBreakdown };
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
  valueTable: SearchEvaluationConfig,
  previousBestAction: LegalAction | null = null,
  interruptionCheck: SearchInterruptionCheck = undefined,
  moveOrdering: AlphaBetaMoveOrderingMode = 'standard',
  quiescenceOptions: AlphaBetaQuiescenceOptions | undefined = undefined,
  killerMoveHistory: KillerMoveHistory | undefined = undefined,
  suppliedRootActions: readonly LegalAction[] | undefined = undefined,
  diagnostics?: SearchDiagnostics
): UnmeasuredAlphaBetaSearchResult {
  validateSearchDepth(depth);
  const rootPlayer = state.turn;
  const statistics: SearchStatistics = {
    visitedPositionCount: 0,
    cutoffCount: 0,
    skippedActionCount: 0,
    quiescenceLeafCount: 0,
    quiescenceVisitedPositionCount: 0,
    quiescenceCutoffCount: 0,
    quiescenceSkippedActionCount: 0,
  };

  if (depth === 0) {
    const evaluationBreakdown = evaluateSearchPositionBreakdown(state, rootPlayer, valueTable);
    return {
      selectedAction: null,
      selectedEvaluation: evaluationBreakdown.total,
      principalVariation: [],
      evaluationBreakdown,
      rootLegalActionCount: 0,
      depth,
      ...statistics,
    };
  }

  const rootActions = suppliedRootActions ?? measured(diagnostics, 'root-legal', () => getLegalActions(state, diagnostics));
  if (rootActions.length === 0) {
    const evaluationBreakdown = evaluateSearchPositionBreakdown(state, rootPlayer, valueTable);
    return {
      selectedAction: null,
      selectedEvaluation: null,
      principalVariation: [],
      evaluationBreakdown,
      rootLegalActionCount: 0,
      depth,
      ...statistics,
    };
  }
  const orderedRootActions = measured(diagnostics, 'normal-order', () => orderIterativeDeepeningRootActionsByMode(
    state, rootActions, previousBestAction, valueTable, interruptionCheck, moveOrdering, diagnostics
  ));
  const indexedRootActions = orderedRootActions.map((action) => ({
    action,
    originalIndex: rootActions.indexOf(action),
  }));
  let bestAction: LegalAction | null = null;
  let bestOriginalIndex = Number.POSITIVE_INFINITY;
  let bestEvaluation = Number.NEGATIVE_INFINITY;
  let bestPrincipalVariation: LegalAction[] = [];
  let bestEvaluationBreakdown: SearchEvaluationBreakdown | null = null;
  let alpha = Number.NEGATIVE_INFINITY;
  const beta = Number.POSITIVE_INFINITY;

  for (const { action: rootAction, originalIndex } of indexedRootActions) {
    interruptionCheck?.();
    const alphaBeforeCandidate = alpha;
    const afterRootAction = measured(diagnostics, 'normal-execute', () => executeSearchAction(state, rootAction));
    statistics.visitedPositionCount += 1;
    let candidateResult = searchAlphaBetaNode(
      afterRootAction,
      depth - 1,
      rootPlayer,
      false,
      alpha,
      beta,
      valueTable,
      statistics,
      interruptionCheck,
      moveOrdering,
      quiescenceOptions,
      killerMoveHistory,
      1,
      diagnostics
    );

    // A root candidate searched after a higher-index PV candidate can be cut
    // off at alpha. Re-search only the one case where that bound could hide an
    // exact tie which belongs to an earlier legal action. This separates the
    // search order from the established root tie-breaking order.
    if (bestAction !== null && originalIndex < bestOriginalIndex &&
      candidateResult.evaluation === bestEvaluation && candidateResult.evaluation === alphaBeforeCandidate) {
      candidateResult = searchAlphaBetaNode(
        afterRootAction,
        depth - 1,
        rootPlayer,
        false,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        valueTable,
        statistics,
        interruptionCheck,
        moveOrdering,
        quiescenceOptions,
        killerMoveHistory,
          1,
          diagnostics
      );
    }

    // The first legal action establishes the baseline even at -Infinity.
    // For iterative root reordering, compare original indexes on exact ties.
    if (bestAction === null || candidateResult.evaluation > bestEvaluation ||
      (candidateResult.evaluation === bestEvaluation && originalIndex < bestOriginalIndex)) {
      bestAction = rootAction;
      bestOriginalIndex = originalIndex;
      bestEvaluation = candidateResult.evaluation;
      bestPrincipalVariation = [
        cloneLegalAction(rootAction),
        ...clonePrincipalVariation(candidateResult.principalVariation),
      ];
      bestEvaluationBreakdown = candidateResult.evaluationBreakdown;
    }
    if (bestEvaluation > alpha) alpha = bestEvaluation;
  }

  if (bestEvaluationBreakdown === null) {
    throw new Error('Alpha-beta search explored no root actions.');
  }

  return {
    selectedAction: bestAction,
    selectedEvaluation: bestAction === null ? null : bestEvaluation,
    principalVariation: clonePrincipalVariation(bestPrincipalVariation),
    evaluationBreakdown: cloneSearchEvaluationBreakdown(bestEvaluationBreakdown),
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
  valueTable: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock,
  options?: AlphaBetaSearchOptions,
  diagnostics?: SearchDiagnostics
): AlphaBetaSearchResult {
  const moveOrdering = resolveMoveOrdering(options);
  const killerMoves = resolveKillerMoves(options);
  const quiescenceOptions = resolveQuiescenceOptions(options);
  const startedAt = clock();
  diagnostics?.begin(startedAt, Number.POSITIVE_INFINITY, clock);
  const searchResult = measured(diagnostics, 'normal-other', () => searchAlphaBeta(
    state, depth, valueTable, null, undefined, moveOrdering, quiescenceOptions,
    killerMoves ? new KillerMoveHistory() : undefined, undefined, diagnostics
  ));
  const result: AlphaBetaSearchResult = {
    ...searchResult,
    principalVariation: clonePrincipalVariation(searchResult.principalVariation),
    evaluationBreakdown: cloneSearchEvaluationBreakdown(searchResult.evaluationBreakdown),
    elapsedMilliseconds: 0,
  };
  const finishedAt = clock();
  result.elapsedMilliseconds = Math.max(0, finishedAt - startedAt);
  diagnostics?.finish(finishedAt);
  return result;
}

/**
 * Completes alpha-beta searches from depth 1 through `maxDepth` in ply.
 * Every completed pass is retained for a future time-limited implementation;
 * this first stage has no clock deadline or interruption path.
 */
export function analyzeIterativeDeepeningAlphaBetaSearch(
  state: BoardState,
  maxDepth: number,
  valueTable: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock,
  options?: AlphaBetaSearchOptions
): IterativeDeepeningAlphaBetaSearchResult {
  const moveOrdering = resolveMoveOrdering(options);
  const killerMoves = resolveKillerMoves(options);
  const quiescenceOptions = resolveQuiescenceOptions(options);
  validateIterativeDeepeningMaxDepth(maxDepth);
  const startedAt = clock();
  const iterations: IterativeDeepeningAlphaBetaIterationResult[] = [];
  let previousBestAction: LegalAction | null = null;
  const killerMoveHistory = killerMoves ? new KillerMoveHistory() : undefined;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const iterationStartedAt = clock();
    const searchResult = searchAlphaBeta(
      state, depth, valueTable, previousBestAction, undefined, moveOrdering, quiescenceOptions, killerMoveHistory
    );
    const iteration = {
      ...searchResult,
      principalVariation: clonePrincipalVariation(searchResult.principalVariation),
      evaluationBreakdown: cloneSearchEvaluationBreakdown(searchResult.evaluationBreakdown),
      elapsedMilliseconds: Math.max(0, clock() - iterationStartedAt),
    };
    iterations.push(iteration);
    previousBestAction = iteration.selectedAction;
  }

  const deepestIteration = iterations[iterations.length - 1];
  return {
    ...deepestIteration,
    principalVariation: clonePrincipalVariation(deepestIteration.principalVariation),
    evaluationBreakdown: cloneSearchEvaluationBreakdown(deepestIteration.evaluationBreakdown),
    elapsedMilliseconds: Math.max(0, clock() - startedAt),
    iterations,
    totalVisitedPositionCount: iterations.reduce(
      (total, iteration) => total + iteration.visitedPositionCount,
      0
    ),
    totalCutoffCount: iterations.reduce((total, iteration) => total + iteration.cutoffCount, 0),
    totalSkippedActionCount: iterations.reduce(
      (total, iteration) => total + iteration.skippedActionCount,
      0
    ),
    totalQuiescenceLeafCount: iterations.reduce((total, iteration) => total + iteration.quiescenceLeafCount, 0),
    totalQuiescenceVisitedPositionCount: iterations.reduce(
      (total, iteration) => total + iteration.quiescenceVisitedPositionCount, 0
    ),
    totalQuiescenceCutoffCount: iterations.reduce((total, iteration) => total + iteration.quiescenceCutoffCount, 0),
    totalQuiescenceSkippedActionCount: iterations.reduce(
      (total, iteration) => total + iteration.quiescenceSkippedActionCount, 0
    ),
  };
}

/**
 * Reserves the first root legal action before searching. Every depth uses the
 * same cooperative deadline. A single synchronous operation (including legal
 * action generation) cannot be preempted between checks.
 */
export function analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(
  state: BoardState,
  maxDepth: number,
  timeLimitMilliseconds: number,
  valueTable: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock,
  options?: AlphaBetaSearchOptions,
  diagnostics?: SearchDiagnostics
): TimeLimitedIterativeDeepeningAlphaBetaSearchResult {
  const moveOrdering = resolveMoveOrdering(options);
  const killerMoves = resolveKillerMoves(options);
  const quiescenceOptions = resolveQuiescenceOptions(options);
  validateIterativeDeepeningMaxDepth(maxDepth);
  validateSearchTimeLimitMilliseconds(timeLimitMilliseconds);
  const startedAt = clock();
  diagnostics?.begin(startedAt, timeLimitMilliseconds, clock);
  const rootActions = measured(diagnostics, 'root-legal', () => getLegalActions(state, diagnostics));
  const fallbackAction = rootActions[0] ?? null;
  const iterations: IterativeDeepeningAlphaBetaIterationResult[] = [];
  let previousBestAction: LegalAction | null = null;
  const killerMoveHistory = killerMoves ? new KillerMoveHistory() : undefined;
  let timedOut = false;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    try {
      const beforeIteration = clock();
      diagnostics?.checked(beforeIteration);
      throwIfSearchTimeLimitReachedAt(beforeIteration, startedAt, timeLimitMilliseconds);

      const iterationStartedAt = clock();
       const check = () => {
         try {
           const observedAt = clock();
           diagnostics?.checked(observedAt);
           throwIfSearchTimeLimitReachedAt(observedAt, startedAt, timeLimitMilliseconds);
         }
         catch (error) { if (error instanceof SearchDeadlineExceeded) diagnostics?.interrupted(); throw error; }
       };
       const searchResult = measured(diagnostics, 'normal-other', () => searchAlphaBeta(
        state,
        depth,
        valueTable,
        previousBestAction,
         check,
        moveOrdering,
        quiescenceOptions,
        killerMoveHistory,
         rootActions,
         diagnostics
       ));
      const iterationFinishedAt = clock();
      diagnostics?.checked(iterationFinishedAt);
      throwIfSearchTimeLimitReachedAt(iterationFinishedAt, startedAt, timeLimitMilliseconds);
      const iteration = {
        ...searchResult,
        principalVariation: clonePrincipalVariation(searchResult.principalVariation),
        evaluationBreakdown: cloneSearchEvaluationBreakdown(searchResult.evaluationBreakdown),
        elapsedMilliseconds: Math.max(0, iterationFinishedAt - iterationStartedAt),
      };
      iterations.push(iteration);
      previousBestAction = iteration.selectedAction;
    } catch (error) {
       if (error instanceof SearchDeadlineExceeded) {
         if (diagnostics?.interruptedPhase === null) diagnostics.interrupted();
        timedOut = true;
        break;
      }
      throw error;
    }
  }

  const deepestIteration = iterations[iterations.length - 1];
  const result: TimeLimitedIterativeDeepeningAlphaBetaSearchResult = {
    ...(deepestIteration ?? {
      selectedAction: fallbackAction === null ? null : cloneLegalAction(fallbackAction),
      selectedEvaluation: null,
      principalVariation: [],
      evaluationBreakdown: null,
      rootLegalActionCount: rootActions.length,
      visitedPositionCount: 0,
      depth: 0,
      cutoffCount: 0,
      skippedActionCount: 0,
      quiescenceLeafCount: 0,
      quiescenceVisitedPositionCount: 0,
      quiescenceCutoffCount: 0,
      quiescenceSkippedActionCount: 0,
    }),
    principalVariation: deepestIteration ? clonePrincipalVariation(deepestIteration.principalVariation) : [],
    evaluationBreakdown: deepestIteration ? cloneSearchEvaluationBreakdown(deepestIteration.evaluationBreakdown) : null,
    elapsedMilliseconds: 0,
    requestedMaxDepth: maxDepth,
    completedDepth: deepestIteration?.depth ?? 0,
    timedOut,
    resultSource: deepestIteration ? 'completed-iteration' : 'fallback',
    iterations,
    totalVisitedPositionCount: iterations.reduce(
      (total, iteration) => total + iteration.visitedPositionCount,
      0
    ),
    totalCutoffCount: iterations.reduce((total, iteration) => total + iteration.cutoffCount, 0),
    totalSkippedActionCount: iterations.reduce(
      (total, iteration) => total + iteration.skippedActionCount,
      0
    ),
    totalQuiescenceLeafCount: iterations.reduce((total, iteration) => total + iteration.quiescenceLeafCount, 0),
    totalQuiescenceVisitedPositionCount: iterations.reduce(
      (total, iteration) => total + iteration.quiescenceVisitedPositionCount, 0
    ),
    totalQuiescenceCutoffCount: iterations.reduce((total, iteration) => total + iteration.quiescenceCutoffCount, 0),
    totalQuiescenceSkippedActionCount: iterations.reduce(
      (total, iteration) => total + iteration.quiescenceSkippedActionCount, 0
    ),
  };
  const finishedAt = clock();
  result.elapsedMilliseconds = Math.max(0, finishedAt - startedAt);
  diagnostics?.finish(finishedAt);
  return result;
}

/** Selects only the best action from the requested recursive search depth. */
export function selectBestAlphaBetaAction(
  state: BoardState,
  depth: number,
  valueTable: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  options?: AlphaBetaSearchOptions
): LegalAction | null {
  return searchAlphaBeta(
    state, depth, valueTable, null, undefined, resolveMoveOrdering(options), resolveQuiescenceOptions(options),
    resolveKillerMoves(options) ? new KillerMoveHistory() : undefined
  ).selectedAction;
}

/** Selects the completed deepest action from iterative-deepening search. */
export function selectBestIterativeDeepeningAlphaBetaAction(
  state: BoardState,
  maxDepth: number,
  valueTable: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  options?: AlphaBetaSearchOptions
): LegalAction | null {
  return analyzeIterativeDeepeningAlphaBetaSearch(state, maxDepth, valueTable, undefined, options).selectedAction;
}

/**
 * Compatibility entry point for callers that still request the old two-ply
 * alpha-beta API. It delegates to the one recursive implementation; no fixed
 * two-ply search body remains in production code.
 */
export function analyzeTwoPlyAlphaBetaSearch(
  state: BoardState,
  valueTable: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  clock: SearchClock = defaultSearchClock,
  options?: AlphaBetaSearchOptions
): TwoPlyAlphaBetaSearchResult {
  const result = analyzeAlphaBetaSearch(state, TWO_PLY_ALPHA_BETA_SEARCH_DEPTH, valueTable, clock, options);
  return {
    selectedAction: result.selectedAction,
    selectedEvaluation: result.selectedEvaluation,
    principalVariation: clonePrincipalVariation(result.principalVariation),
    evaluationBreakdown: cloneSearchEvaluationBreakdown(result.evaluationBreakdown),
    rootLegalActionCount: result.rootLegalActionCount,
    visitedPositionCount: result.visitedPositionCount,
    depth: TWO_PLY_ALPHA_BETA_SEARCH_DEPTH,
    elapsedMilliseconds: result.elapsedMilliseconds,
    prunedRootCandidateCount: result.cutoffCount,
    skippedOpponentReplyCount: result.skippedActionCount,
    quiescenceLeafCount: result.quiescenceLeafCount,
    quiescenceVisitedPositionCount: result.quiescenceVisitedPositionCount,
    quiescenceCutoffCount: result.quiescenceCutoffCount,
    quiescenceSkippedActionCount: result.quiescenceSkippedActionCount,
  };
}

/** Compatibility selector that preserves the established default depth of 2. */
export function selectBestTwoPlyAlphaBetaAction(
  state: BoardState,
  valueTable: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  options?: AlphaBetaSearchOptions
): LegalAction | null {
  return selectBestAlphaBetaAction(state, TWO_PLY_ALPHA_BETA_SEARCH_DEPTH, valueTable, options);
}
