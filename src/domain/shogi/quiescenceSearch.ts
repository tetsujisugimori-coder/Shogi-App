/**
 * A bounded tactical extension for a fixed evaluation perspective. This is a
 * standalone domain API: callers opt in explicitly and existing alpha-beta,
 * Worker, and UI paths do not invoke it.
 */
import type { BoardState, Player } from '../../types/shogi';
import { isPlayerInCheck } from './checkmate';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import { DEFAULT_MATERIAL_VALUE_TABLE } from './materialEvaluation';
import { cloneBoardState } from './replay';
import {
  evaluateSearchPositionBreakdown,
  type SearchEvaluationBreakdown,
  type SearchEvaluationConfig,
} from './twoPlyMinimaxAi';

/** A cooperative check run at node entry and around every candidate execution. */
export type QuiescenceSearchInterruptionCheck = (() => void) | undefined;

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
}

interface SearchNodeResult {
  evaluation: number;
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

function executeSearchAction(state: BoardState, action: LegalAction): BoardState {
  const execution = executeLegalAction(cloneBoardState(state), action);
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
  alpha: number,
  beta: number,
  evaluation: SearchEvaluationConfig,
  statistics: SearchStatistics,
  interruptionCheck: QuiescenceSearchInterruptionCheck
): SearchNodeResult {
  interruptionCheck?.();
  const staticBreakdown = evaluateSearchPositionBreakdown(state, perspective, evaluation);
  if (state.status === 'ended' || remainingDepth === 0) {
    // A depth-zero checked position is deliberately a static approximation;
    // the caller's safety cap takes precedence over a forced evasion.
    return { evaluation: staticBreakdown.total, evaluationBreakdown: staticBreakdown, principalVariation: [] };
  }

  const isInCheck = isPlayerInCheck(state, state.turn);
  const actions = getLegalActions(state);
  const candidates = isInCheck ? actions : actions.filter((action) => isCapture(state, action));

  // Reachable no-response positions are ended by the existing adjudication
  // path. Keep malformed in-progress positions finite and deterministic too.
  if (candidates.length === 0) {
    return { evaluation: staticBreakdown.total, evaluationBreakdown: staticBreakdown, principalVariation: [] };
  }

  const isMaximizing = state.turn === perspective;
  let selectedEvaluation = isInCheck
    ? (isMaximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY)
    : staticBreakdown.total;
  let selectedBreakdown: SearchEvaluationBreakdown | null = isInCheck ? null : staticBreakdown;
  let principalVariation: LegalAction[] = [];

  // In a non-check position, stand-pat is the first candidate and wins all
  // ties. Its bound may therefore make every tactical child unnecessary.
  if (!isInCheck) {
    if (isMaximizing) alpha = Math.max(alpha, selectedEvaluation);
    else beta = Math.min(beta, selectedEvaluation);
    if (alpha >= beta) {
      statistics.cutoffCount += 1;
      statistics.skippedActionCount += candidates.length;
      return { evaluation: selectedEvaluation, evaluationBreakdown: selectedBreakdown!, principalVariation };
    }
  }

  for (let actionIndex = 0; actionIndex < candidates.length; actionIndex += 1) {
    interruptionCheck?.();
    const action = candidates[actionIndex];
    const child = executeSearchAction(state, action);
    statistics.visitedPositionCount += 1;
    interruptionCheck?.();
    const childResult = searchNode(
      child,
      remainingDepth - 1,
      perspective,
      alpha,
      beta,
      evaluation,
      statistics,
      interruptionCheck
    );

    const adoptsCandidate = isInCheck && selectedBreakdown === null ||
      (isMaximizing ? childResult.evaluation > selectedEvaluation : childResult.evaluation < selectedEvaluation);
    if (adoptsCandidate) {
      selectedEvaluation = childResult.evaluation;
      selectedBreakdown = childResult.evaluationBreakdown;
      principalVariation = [cloneLegalAction(action), ...childResult.principalVariation.map(cloneLegalAction)];
    }

    if (isMaximizing) alpha = Math.max(alpha, selectedEvaluation);
    else beta = Math.min(beta, selectedEvaluation);
    const remainingActionCount = candidates.length - actionIndex - 1;
    if (alpha >= beta && remainingActionCount > 0) {
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
 * Searches only legal captures in ordinary positions and every legal evasion
 * while the side to move is checked. The fixed `perspective` is maximized on
 * that player's turns and minimized on the opponent's turns.
 */
export function analyzeQuiescenceSearch(
  state: BoardState,
  perspective: Player,
  maxTacticalDepth: number,
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE,
  interruptionCheck: QuiescenceSearchInterruptionCheck = undefined
): QuiescenceSearchResult {
  validateMaxTacticalDepth(maxTacticalDepth);
  const statistics: SearchStatistics = { visitedPositionCount: 0, cutoffCount: 0, skippedActionCount: 0 };
  const result = searchNode(
    state,
    maxTacticalDepth,
    perspective,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    evaluation,
    statistics,
    interruptionCheck
  );
  return {
    selectedEvaluation: result.evaluation,
    evaluationBreakdown: cloneBreakdown(result.evaluationBreakdown),
    principalVariation: result.principalVariation.map(cloneLegalAction),
    maxTacticalDepth,
    ...statistics,
  };
}
