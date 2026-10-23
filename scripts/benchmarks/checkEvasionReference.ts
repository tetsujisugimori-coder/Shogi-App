import type { BoardState, Player } from '../../src/types/shogi';
import { getLegalActions } from '../../src/domain/shogi/legalActions';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { evaluateSearchPositionBreakdown, evaluateNoLegalActionsPositionBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { apply, compareReference, type ReferenceLeaf } from './terminalDistanceReference';

// Full-width reference: no product search, searchValue, pruning, ordering or TT.
// Shares legal execution and static evaluator, so this is not an independent rules engine.
export function evasionReference(s: BoardState, depth: number, q: number, extra: number,
  root: Player = s.turn, ply = 0, reverse = false, includeQuietPromotions = false): ReferenceLeaf {
  let breakdown = evaluateSearchPositionBreakdown(s, root);
  const checked = isPlayerInCheck(s, s.turn);
  const tactical = depth === 0;
  const extending = tactical && q === 0 && checked && extra > 0;
  const leaf = (): ReferenceLeaf => ({ breakdown, pv: [], reason: s.result?.endReason ?? null,
    terminalDistancePly: breakdown.terminal === 'win' || breakdown.terminal === 'loss' ? ply : null });
  if (s.status === 'ended' || tactical && q === 0 && !extending) return leaf();
  let actions = getLegalActions(s);
  if (extending && actions.length === 0) { breakdown = evaluateNoLegalActionsPositionBreakdown(s,root); return leaf(); }
  if (tactical && !checked) actions = actions.filter(a => a.kind === 'move' &&
    (s.squares[a.to.row][a.to.col].piece !== null || includeQuietPromotions && a.promotion === 'promote'));
  if (reverse) actions.reverse();
  let best: ReferenceLeaf | null = tactical && !checked ? leaf() : null;
  for (const a of actions) {
    const v = evasionReference(apply(s,a), Math.max(0,depth-1), tactical ? Math.max(0,q-1) : q,
      extra - (extending ? 1 : 0),root,ply+1,reverse,includeQuietPromotions);
    const candidate = { ...v, pv:[a,...v.pv] };
    if (!best || (s.turn === root ? compareReference(candidate,best)>0 : compareReference(candidate,best)<0)) best=candidate;
  }
  return best ?? leaf();
}
