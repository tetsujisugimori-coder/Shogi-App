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
} from './materialEvaluation';
import { evaluateSearchPosition, type SearchEvaluationConfig } from './twoPlyMinimaxAi';
import { cloneBoardState } from './replay';

/**
 * Selects the legal action whose resulting non-terminal position has the
 * highest material-plus-piece-square evaluation from the supplied perspective.
 *
 * Every candidate is applied to an independent cloned state. The perspective
 * intentionally remains fixed even though applying a move changes turn. Ties
 * retain the first action returned by getLegalActions, preserving its stable
 * ordering. Returns null when there are no legal actions.
 */
export function selectBestMaterialAction(
  state: BoardState,
  perspective: Player,
  evaluation: SearchEvaluationConfig = DEFAULT_MATERIAL_VALUE_TABLE
): LegalAction | null {
  const actions = getLegalActions(state);
  let bestAction: LegalAction | null = null;
  let bestEvaluation = Number.NEGATIVE_INFINITY;

  for (const action of actions) {
    const execution = executeLegalAction(cloneBoardState(state), action);
    if (execution.type !== 'applied') continue;

    const candidateEvaluation = evaluateSearchPosition(execution.state, perspective, evaluation);
    if (candidateEvaluation > bestEvaluation) {
      bestAction = action;
      bestEvaluation = candidateEvaluation;
    }
  }

  return bestAction;
}
