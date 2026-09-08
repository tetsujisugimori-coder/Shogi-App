/**
 * One-ply material AI built from the public legal-action and evaluation APIs.
 *
 * This module chooses an action only. Applying the selected action to the
 * actual game remains the responsibility of executeLegalAction's caller.
 */
import type { BoardState, Player } from '../../types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import {
  DEFAULT_MATERIAL_VALUE_TABLE,
  evaluateMaterial,
  type MaterialValueTable,
} from './materialEvaluation';
import { cloneBoardState } from './replay';

/**
 * Selects the legal action whose resulting position has the highest material
 * evaluation from the supplied AI perspective.
 *
 * Every candidate is applied to an independent cloned state. The perspective
 * intentionally remains fixed even though applying a move changes turn. Ties
 * retain the first action returned by getLegalActions, preserving its stable
 * ordering. Returns null when there are no legal actions.
 */
export function selectBestMaterialAction(
  state: BoardState,
  perspective: Player,
  valueTable: MaterialValueTable = DEFAULT_MATERIAL_VALUE_TABLE
): LegalAction | null {
  const actions = getLegalActions(state);
  let bestAction: LegalAction | null = null;
  let bestEvaluation = Number.NEGATIVE_INFINITY;

  for (const action of actions) {
    const execution = executeLegalAction(cloneBoardState(state), action);
    if (execution.type !== 'applied') continue;

    const evaluation = evaluateMaterial(execution.state, perspective, valueTable);
    if (evaluation > bestEvaluation) {
      bestAction = action;
      bestEvaluation = evaluation;
    }
  }

  return bestAction;
}
