/**
 * Minimal local-AI action selection built on the public legal-action boundary.
 *
 * This module deliberately selects an existing action only. Applying it remains
 * the responsibility of executeLegalAction, so it does not duplicate rules or
 * mutate a BoardState.
 */
import { BoardState } from '../../types/shogi';
import { getLegalActions, LegalAction } from './legalActions';

/**
 * Source of a uniformly distributed value in the half-open interval [0, 1).
 *
 * Callers can provide a deterministic implementation for reproducible tests.
 * Values outside this contract are intentionally not corrected here.
 */
export type RandomValueGenerator = () => number;

/**
 * Selects one currently legal action without changing the supplied position.
 *
 * getLegalActions owns rule evaluation and its deterministic candidate order.
 * This function preserves that order and uses the injected random source only
 * to choose an index. It returns null when the position has no legal actions.
 */
export function selectRandomLegalAction(
  state: BoardState,
  random: RandomValueGenerator = Math.random
): LegalAction | null {
  const actions = getLegalActions(state);
  if (actions.length === 0) return null;

  return actions[Math.floor(random() * actions.length)];
}
