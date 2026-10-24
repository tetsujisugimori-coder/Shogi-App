import { selectQuietPromotions, validateQuietPromotionSelection, type QuietPromotionSelection } from './quietPromotionSelection';
import { searchValue, compareSearchValues as compare, numericalSearchBound, SEARCH_BOTTOM, SEARCH_TOP, type SearchValue } from './searchValue';
/**
 * A bounded tactical extension for a fixed evaluation perspective. This is a
 * domain API: alpha-beta callers opt in explicitly; Worker/UI defaults stay unchanged.
 */
import type { BoardState, Player } from '../../types/shogi';
import { isPlayerInCheck } from './checkmate';
import { executeLegalAction, getLegalActions, getQuiescenceLegalActionsWithDiagnostics, type LegalAction } from './legalActions';
import { measured, type SearchDiagnostics } from './searchDiagnostics';
import { DEFAULT_MATERIAL_VALUE_TABLE } from './materialEvaluation';
import { orderQuiescenceCandidates, resolveQuiescenceMoveOrdering, type QuiescenceMoveOrderingMode } from './quiescenceOrdering';
import {
  evaluateSearchPositionBreakdown,
  evaluateNoLegalActionsPositionBreakdown,
  resolveSearchMaterialValueTable,
  type SearchEvaluationBreakdown,
  type SearchEvaluationConfig,
} from './twoPlyMinimaxAi';

/** A cooperative check run at node entry and around every candidate execution. */
export type QuiescenceSearchInterruptionCheck = (() => void) | undefined;

/** Attempted work, including interrupted calls. Independent of completed-pass counters. */
export interface CheckEvasionStatistics {
  visitedPositionCount: number;
  maxExtensionDepth: number;
  limitReachedCount: number;
}

export function createCheckEvasionStatistics(): CheckEvasionStatistics {
  return { visitedPositionCount: 0, maxExtensionDepth: 0, limitReachedCount: 0 };
}

export function validateMaxCheckEvasionExtensions(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError('Maximum check evasion extensions must be an integer from 0 to 2 ply.');
  }
}

/**
 * Result of one bounded quiescence search. `visitedPositionCount` excludes the
 * supplied root and counts every child state created for an explored action.
 * `cutoffCount` counts candidate loops stopped by alpha-beta, while
 * `skippedActionCount` counts the candidates not executed in those loops.
 */
export interface QuiescenceSearchResult {
  selectedEvaluation: number;
  evaluationBreakdown: SearchEvaluationBreakdown;
  principalVariation: LegalAction[];
  visitedPositionCount: number;
  maxTacticalDepth: number;
  cutoffCount: number;
  skippedActionCount: number;
}

interface SearchStatistics {
  visitedPositionCount: number;
  cutoffCount: number;
  skippedActionCount: number;
  checkEvasionLimitReached: boolean;
}

interface SearchNodeResult {
  evaluation: SearchValue;
  evaluationBreakdown: SearchEvaluationBreakdown;
  principalVariation: LegalAction[];
}

function cloneLegalAction(action: LegalAction): LegalAction {
  return action.kind === 'move'
    ? { ...action, from: { ...action.from }, to: { ...action.to } }
    : { ...action, to: { ...action.to } };
}

function cloneBreakdown(breakdown: SearchEvaluationBreakdown): SearchEvaluationBreakdown {
  return { ...breakdown };
}

function executeSearchAction(state: BoardState, action: LegalAction, diagnostics?: SearchDiagnostics): BoardState {
  // executeLegalAction already creates a successor without changing state.
  const execution = executeLegalAction(state, action, undefined, diagnostics);
  if (execution.type !== 'applied') {
    throw new Error('A generated legal action could not be executed during quiescence search.');
  }
  return execution.state;
}

function validateMaxTacticalDepth(maxTacticalDepth: number): void {
  if (!Number.isInteger(maxTacticalDepth) || maxTacticalDepth < 0) {
    throw new Error('Quiescence search maximum tactical depth must be a non-negative integer measured in ply.');
  }
}

function isCapture(state: BoardState, action: LegalAction): boolean {
  if (action.kind !== 'move') return false;
  const target = state.squares[action.to.row]?.[action.to.col]?.piece;
  return target !== null && target !== undefined && target.player !== action.player;
}

function searchNode(
  state: BoardState,
  remainingDepth: number,
  perspective: Player,
  alpha: SearchValue,
  beta: SearchValue,
  evaluation: SearchEvaluationConfig,
  statistics: SearchStatistics,
  interruptionCheck: QuiescenceSearchInterruptionCheck,
  moveOrdering: QuiescenceMoveOrderingMode,
  diagnostics: SearchDiagnostics | undefined,
  ply: number,
  remainingCheckEvasions: number,
  extensionPly: number,
  checkEvasionStatistics: CheckEvasionStatistics | undefined,
  includeQuietPromotions: boolean,
  selectiveQuietPromotions: QuietPromotionSelection | undefined
): SearchNodeResult {
  const emit = diagnostics?.traceNode;
  emit?.({kind:'enter', phase:'quiescence', state, ply, remainingDepth, remainingCheckEvasions, extensionPly, alpha, beta});
  const result = searchNodeBody(state, remainingDepth, perspective, alpha, beta, evaluation,
    statistics, interruptionCheck, moveOrdering, diagnostics, ply, remainingCheckEvasions, extensionPly, checkEvasionStatistics, includeQuietPromotions, selectiveQuietPromotions);
  emit?.({kind:'return', phase:'quiescence', state, ply, remainingDepth, remainingCheckEvasions, extensionPly, alpha, beta, value:result.evaluation});
  return result;
}

function searchNodeBody(
  state: BoardState,
  remainingDepth: number,
  perspective: Player,
  alpha: SearchValue,
  beta: SearchValue,
  evaluation: SearchEvaluationConfig,
  statistics: SearchStatistics,
  interruptionCheck: QuiescenceSearchInterruptionCheck,
  moveOrdering: QuiescenceMoveOrderingMode,
  diagnostics: SearchDiagnostics | undefined,
  ply: number,
  remainingCheckEvasions: number,
  extensionPly: number,
  checkEvasionStatistics: CheckEvasionStatistics | undefined,
  includeQuietPromotions: boolean,
  selectiveQuietPromotions: QuietPromotionSelection | undefined
): SearchNodeResult {
  const note = diagnostics?.traceNode ? (kind: 'stop'|'cutoff', reason: string) => diagnostics.traceNode!({kind, phase:'quiescence', state, ply, remainingDepth, remainingCheckEvasions, extensionPly, reason}) : undefined;
  diagnostics?.setStage('quiescence-entry');
  interruptionCheck?.();
  const staticBreakdown = measured(diagnostics, 'q-evaluate', () => evaluateSearchPositionBreakdown(state, perspective, evaluation));
  if (state.status === 'ended' || remainingDepth === 0 && remainingCheckEvasions === 0 && extensionPly === 0) {
    note?.('stop', state.status === 'ended' ? 'terminal' : 'q-horizon');
    // Preserve the historical zero-option path, including interruption checks.
    return { evaluation: searchValue(staticBreakdown, ply), evaluationBreakdown: staticBreakdown, principalVariation: [] };
  }

  const isInCheck = measured(diagnostics, 'q-check', () => isPlayerInCheck(state, state.turn));
  const extending = remainingDepth === 0 && isInCheck && remainingCheckEvasions > 0;
  if (remainingDepth === 0 && !extending) {
    note?.('stop', isInCheck ? 'evasion-cap' : 'q-horizon');
    if (isInCheck) {
      statistics.checkEvasionLimitReached = true;
      if (checkEvasionStatistics) checkEvasionStatistics.limitReachedCount++;
    }
    return { evaluation: searchValue(staticBreakdown, ply), evaluationBreakdown: staticBreakdown, principalVariation: [] };
  }
  if (extensionPly > 0 || extending) interruptionCheck?.();
  const actions = measured(diagnostics, 'q-legal', () => diagnostics
    ? getQuiescenceLegalActionsWithDiagnostics(state, diagnostics) : getLegalActions(state));
  if (extensionPly > 0 || extending) interruptionCheck?.();
  const selectedPromotions = !isInCheck && selectiveQuietPromotions
    ? measured(diagnostics, 'q-select-promotions', () => selectQuietPromotions(state, actions,
      resolveSearchMaterialValueTable(evaluation), selectiveQuietPromotions, interruptionCheck)) : [];
  const candidates = isInCheck ? actions : actions.filter((action) => isCapture(state, action) ||
    includeQuietPromotions && action.kind === 'move' && action.promotion === 'promote' ||
    selectedPromotions.includes(action));
  if (diagnostics && !isInCheck) {
    diagnostics.quietPromotions.considered += actions.filter(a => a.kind === 'move' && a.promotion === 'promote' && !isCapture(state,a)).length;
    diagnostics.quietPromotions.added += candidates.filter(a => !isCapture(state,a)).length;
  }

  // Child execution normally adjudicates no-response positions. In the new
  // extension path, also resolve custom checked roots through the shared evaluator.
  // The historical path preserves its static approximation for custom inputs.
  if (candidates.length === 0) {
    note?.('stop', extending ? 'no-legal-evasion' : 'no-tactical-candidate');
    if (extending) {
      const breakdown = evaluateNoLegalActionsPositionBreakdown(state, perspective, evaluation);
      return { evaluation: searchValue(breakdown, ply), evaluationBreakdown: breakdown, principalVariation: [] };
    }
    return { evaluation: searchValue(staticBreakdown, ply), evaluationBreakdown: staticBreakdown, principalVariation: [] };
  }

  const isMaximizing = state.turn === perspective;
  let selectedEvaluation = isInCheck
    ? (isMaximizing ? SEARCH_BOTTOM : SEARCH_TOP)
    : searchValue(staticBreakdown, ply);
  let selectedBreakdown: SearchEvaluationBreakdown | null = isInCheck ? null : staticBreakdown;
  let principalVariation: LegalAction[] = [];

  // In a non-check position, stand-pat is the first candidate and wins all
  // ties. Its bound may therefore make every tactical child unnecessary.
  if (!isInCheck) {
    if (isMaximizing) { if (compare(selectedEvaluation, alpha) > 0) alpha = selectedEvaluation; }
    else { if (compare(selectedEvaluation, beta) < 0) beta = selectedEvaluation; }
    if (compare(alpha, beta) >= 0) {
      note?.('cutoff', 'stand-pat-window');
      statistics.cutoffCount += 1;
      statistics.skippedActionCount += candidates.length;
      return { evaluation: selectedEvaluation, evaluationBreakdown: selectedBreakdown!, principalVariation };
    }
  }

  const orderedCandidates = moveOrdering === 'original' ? candidates : measured(diagnostics, 'q-order', () => orderQuiescenceCandidates(
    state, candidates, moveOrdering, resolveSearchMaterialValueTable(evaluation), interruptionCheck
  ));
  for (let actionIndex = 0; actionIndex < candidates.length; actionIndex += 1) {
    diagnostics?.setStage('before-quiescence-candidate');
    interruptionCheck?.();
    const action = orderedCandidates[actionIndex];
    const child = measured(diagnostics, 'q-execute', () => executeSearchAction(state, action, diagnostics));
    statistics.visitedPositionCount += 1;
    if (extending && checkEvasionStatistics) {
      checkEvasionStatistics.visitedPositionCount++;
      checkEvasionStatistics.maxExtensionDepth = Math.max(checkEvasionStatistics.maxExtensionDepth, extensionPly + 1);
    }
    diagnostics?.setStage('after-quiescence-action');
    interruptionCheck?.();
    const childResult = searchNode(
      child,
      Math.max(0, remainingDepth - 1),
      perspective,
      alpha,
      beta,
      evaluation,
      statistics,
      interruptionCheck,
      moveOrdering,
      diagnostics, ply + 1,
      remainingCheckEvasions - (extending ? 1 : 0),
      extensionPly + (extending ? 1 : 0), checkEvasionStatistics, includeQuietPromotions, selectiveQuietPromotions
    );
    if (extensionPly > 0 || extending) interruptionCheck?.();

    const adoptsCandidate = isInCheck && selectedBreakdown === null ||
      (isMaximizing ? compare(childResult.evaluation, selectedEvaluation) > 0 : compare(childResult.evaluation, selectedEvaluation) < 0);
    if (adoptsCandidate) {
      selectedEvaluation = childResult.evaluation;
      selectedBreakdown = childResult.evaluationBreakdown;
      principalVariation = [cloneLegalAction(action), ...childResult.principalVariation.map(cloneLegalAction)];
    }

    if (isMaximizing) { if (compare(selectedEvaluation, alpha) > 0) alpha = selectedEvaluation; }
    else { if (compare(selectedEvaluation, beta) < 0) beta = selectedEvaluation; }
    const remainingActionCount = candidates.length - actionIndex - 1;
    if (compare(alpha, beta) >= 0 && remainingActionCount > 0) {
      note?.('cutoff', 'alpha-beta');
      statistics.cutoffCount += 1;
      statistics.skippedActionCount += remainingActionCount;
      break;
    }
  }

  if (selectedBreakdown === null) {
    throw new Error('Quiescence search explored no legal check evasions.');
  }
  return { evaluation: selectedEvaluation, evaluationBreakdown: selectedBreakdown, principalVariation };
}

/**
 * Searches legal captures (and opt-in quiet promotions) within the same tactical
 * depth in ordinary positions, and every legal evasion
 * while the side to move is checked. The fixed `perspective` is maximized on
 * that player's turns and minimized on the opponent's turns.
 */
export function analyzeQuiescenceSearch(
  state: BoardState,
  perspective: Player,
  maxTacticalDepth: number,
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  interruptionCheck: QuiescenceSearchInterruptionCheck = undefined,
  moveOrdering: QuiescenceMoveOrderingMode = 'original',
  maxCheckEvasionExtensions = 0,
  checkEvasionStatistics?: CheckEvasionStatistics,
  includeQuietPromotions = false,
  selectiveQuietPromotions?: QuietPromotionSelection
): QuiescenceSearchResult {
  return analyzeQuiescenceSearchWithinBounds(
    state,
    perspective,
    maxTacticalDepth,
    evaluation,
    interruptionCheck,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    moveOrdering, undefined, maxCheckEvasionExtensions, checkEvasionStatistics, includeQuietPromotions, selectiveQuietPromotions
  );
}

/**
 * Internal alpha-beta integration boundary. It keeps the standalone public
 * API's unbounded behavior while allowing a fixed-depth caller to preserve
 * its current alpha/beta window at a tactical leaf.
 */
export function analyzeQuiescenceSearchWithInternalBounds(
  state: BoardState,
  perspective: Player,
  maxTacticalDepth: number,
  evaluation: SearchEvaluationConfig,
  interruptionCheck: QuiescenceSearchInterruptionCheck,
  alpha: SearchValue,
  beta: SearchValue,
  moveOrdering: QuiescenceMoveOrderingMode = 'original',
  diagnostics?: SearchDiagnostics,
  rootPly = 0,
  maxCheckEvasionExtensions = 0,
  checkEvasionStatistics?: CheckEvasionStatistics,
  includeQuietPromotions = false,
  selectiveQuietPromotions?: QuietPromotionSelection
): QuiescenceSearchResult & { searchValue: SearchValue; checkEvasionLimitReached?: boolean } {
  if (typeof includeQuietPromotions !== 'boolean') {
    throw new RangeError('Quiescence includeQuietPromotions must be a boolean.');
  }
  validateQuietPromotionSelection(selectiveQuietPromotions);
  if (includeQuietPromotions && selectiveQuietPromotions) throw new RangeError('Choose all or selective quiet promotions, not both.');
  validateMaxTacticalDepth(maxTacticalDepth);
  validateMaxCheckEvasionExtensions(maxCheckEvasionExtensions);
  const resolvedOrdering = resolveQuiescenceMoveOrdering(moveOrdering);
  const statistics: SearchStatistics = { visitedPositionCount: 0, cutoffCount: 0, skippedActionCount: 0, checkEvasionLimitReached: false };
  const result = searchNode(
    state,
    maxTacticalDepth,
    perspective,
    alpha,
    beta,
    evaluation,
    statistics,
    interruptionCheck,
    resolvedOrdering,
    diagnostics, rootPly, maxCheckEvasionExtensions, 0, checkEvasionStatistics, includeQuietPromotions, selectiveQuietPromotions
  );
  return {
    selectedEvaluation: result.evaluationBreakdown.total,
    searchValue: result.evaluation,
    evaluationBreakdown: cloneBreakdown(result.evaluationBreakdown),
    principalVariation: result.principalVariation.map(cloneLegalAction),
    maxTacticalDepth,
    ...statistics,
  };
}

/** Preserve the established numerical-window API; internal callers carry distance. */
export function analyzeQuiescenceSearchWithinBounds(
  state: BoardState, perspective: Player, maxTacticalDepth: number,
  evaluation: SearchEvaluationConfig, interruptionCheck: QuiescenceSearchInterruptionCheck,
  alpha: number, beta: number, moveOrdering: QuiescenceMoveOrderingMode = 'original',
  diagnostics?: SearchDiagnostics,
  maxCheckEvasionExtensions = 0,
  checkEvasionStatistics?: CheckEvasionStatistics,
  includeQuietPromotions = false,
  selectiveQuietPromotions?: QuietPromotionSelection
): QuiescenceSearchResult {
  const { searchValue: _internal, checkEvasionLimitReached: _limit, ...result } = analyzeQuiescenceSearchWithInternalBounds(
    state, perspective, maxTacticalDepth, evaluation, interruptionCheck,
    numericalSearchBound(alpha), numericalSearchBound(beta), moveOrdering, diagnostics, 0,
    maxCheckEvasionExtensions, checkEvasionStatistics, includeQuietPromotions, selectiveQuietPromotions
  );
  return result;
}
