import type { SearchEvaluationBreakdown } from './twoPlyMinimaxAi';

/** Search-only root-perspective ordering. Never serialized as a public score.
 * Distance records an observed terminal leaf, not a forced-win certificate.
 * Window sentinels are strictly outside all values, including decisive leaves.
 */
export type SearchValue =
  | { readonly category: 'win' | 'loss'; readonly terminalDistancePly: number }
  | { readonly category: 'non-terminal'; readonly evaluation: number }
  | { readonly category: 'bottom' | 'top' };

export const SEARCH_BOTTOM: SearchValue = { category: 'bottom' };
export const SEARCH_TOP: SearchValue = { category: 'top' };

export function searchValue(breakdown: SearchEvaluationBreakdown, rootPly: number): SearchValue {
  return breakdown.terminal === 'win' || breakdown.terminal === 'loss'
    ? { category: breakdown.terminal, terminalDistancePly: rootPly }
    : { category: 'non-terminal', evaluation: breakdown.total };
}

const rank = { bottom: 0, loss: 1, 'non-terminal': 2, win: 3, top: 4 } as const;

/** Positive means left is preferable to the root player. */
export function compareSearchValues(left: SearchValue, right: SearchValue): number {
  if (left.category !== right.category) return rank[left.category] - rank[right.category];
  if ((left.category === 'win' || left.category === 'loss') &&
      (right.category === 'win' || right.category === 'loss')) {
    return left.category === 'win'
      ? right.terminalDistancePly - left.terminalDistancePly
      : left.terminalDistancePly - right.terminalDistancePly;
  }
  if (left.category === 'non-terminal' && right.category === 'non-terminal') {
    if (left.evaluation === right.evaluation) return 0;
    return left.evaluation > right.evaluation ? 1 : -1;
  }
  return 0;
}

/** Legacy numerical quiescence windows use infinities as open sentinels. */
export function numericalSearchBound(value: number): SearchValue {
  return value === -Infinity ? SEARCH_BOTTOM : value === Infinity ? SEARCH_TOP
    : { category: 'non-terminal', evaluation: value };
}
