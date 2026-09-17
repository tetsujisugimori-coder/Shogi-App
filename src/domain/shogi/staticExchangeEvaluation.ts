import type { BoardState, Player } from '../../types/shogi';
import type { Coordinate } from './coordinates';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
  evaluateMaterial,
  type MaterialValueTable,
} from './materialEvaluation';
import { cloneBoardState } from './replay';

// Keep the membership check independent of search and compare every action field:
// execution alone does not validate the supplied player/pieceType metadata.
function sameAction(left: LegalAction, right: LegalAction): boolean {
  if (left.player !== right.player || left.pieceType !== right.pieceType ||
      left.promotion !== right.promotion ||
      left.to.row !== right.to.row || left.to.col !== right.to.col) return false;
  if (left.kind === 'move' && right.kind === 'move') {
    return left.from.row === right.from.row && left.from.col === right.from.col;
  }
  return left.kind === 'drop' && right.kind === 'drop' && left.pieceId === right.pieceId;
}

function applyLegalAction(state: BoardState, action: LegalAction): BoardState {
  const execution = executeLegalAction(cloneBoardState(state), action);
  if (execution.type !== 'applied') {
    throw new Error('Static exchange legal-action contract violated: generated action could not be applied.');
  }
  return execution.state;
}

function evaluateExchangeContinuation(
  state: BoardState,
  target: Coordinate,
  perspective: Player,
  baseline: number,
  valueTable: MaterialValueTable
): number {
  const current = evaluateMaterial(state, perspective, valueTable) - baseline;
  if (!Number.isFinite(current)) {
    throw new RangeError('Static exchange requires a finite material difference.');
  }
  if (state.status === 'ended') return current;

  const actions = getLegalActions(state);
  if (actions.length === 0) return current;
  const occupant = state.squares[target.row][target.col].piece;
  const recaptures = actions.filter((candidate) =>
    candidate.kind === 'move' &&
    candidate.to.row === target.row && candidate.to.col === target.col &&
    occupant !== null && occupant.player !== candidate.player
  );

  // Another legal action represents ending the exchange at the current score;
  // that action is not played. If every legal action is a recapture, it is forced.
  let best = recaptures.length < actions.length ? current : null;
  for (const recapture of recaptures) {
    // Each continuation removes one board piece, so no depth limit is needed.
    const score = evaluateExchangeContinuation(
      applyLegalAction(state, recapture), target, perspective, baseline, valueTable
    );
    best = best === null ? score : state.turn === perspective
      ? Math.max(best, score)
      : Math.min(best, score);
  }
  return best ?? current;
}

/**
 * Pure, deterministic material delta for a legal capture and optimal legal
 * recaptures on its destination, from the initiating player's fixed perspective.
 * Legal drops/quiet moves return null; actions absent from getLegalActions throw.
 * Terminal outcomes keep their material delta, never a win/loss infinity.
 * Non-finite material differences (including custom-table overflow) throw.
 * This foundation is not connected to search, ordering, Worker, or UI.
 */
export function evaluateStaticExchange(
  state: BoardState,
  action: LegalAction,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): number | null {
  const legalAction = getLegalActions(state).find((candidate) => sameAction(candidate, action));
  if (!legalAction) {
    throw new Error('Static exchange requires an action legal in the starting position.');
  }
  if (legalAction.kind === 'drop' || !state.squares[legalAction.to.row][legalAction.to.col].piece) {
    return null;
  }
  const baseline = evaluateMaterial(state, legalAction.player, valueTable);
  return evaluateExchangeContinuation(
    applyLegalAction(state, legalAction), legalAction.to, legalAction.player, baseline, valueTable
  );
}
