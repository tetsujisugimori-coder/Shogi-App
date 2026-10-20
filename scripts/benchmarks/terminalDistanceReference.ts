import assert from 'node:assert/strict';
import type { BoardState, Player } from '../../src/types/shogi';
import { getLegalActions, executeLegalAction, type LegalAction } from '../../src/domain/shogi/legalActions';
import { evaluateSearchPositionBreakdown, type SearchEvaluationBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { constructed, rotate, tacticalPositions } from './tacticalPositions';

export function distancePositions() {
  const loss = constructed('terminal-resistance', [[0,1,'king','gote'],[2,0,'king','sente'],
    [1,5,'gold','sente'],[2,1,'gold','sente']], 'gote');
  return [...tacticalPositions(), { id: 'terminal-resistance', state: loss },
    { id: 'terminal-resistance-gote', state: rotate(loss, 'terminal-resistance-gote') }];
}

export function apply(s: BoardState, a: LegalAction) {
  const e = executeLegalAction(s, a); assert.equal(e.type, 'applied');
  if (e.type !== 'applied') throw Error('execution');
  return e.state;
}

export interface ReferenceLeaf {
  breakdown: SearchEvaluationBreakdown;
  pv: LegalAction[];
  terminalDistancePly: number | null;
  reason: string | null;
}

// Independent comparison: no product search value, search recursion, pruning,
// ordering, or q implementation. Draw stays a numeric zero, with no distance.
export function compareReference(a: ReferenceLeaf, b: ReferenceLeaf): number {
  const rank = (v: ReferenceLeaf) => v.breakdown.terminal === 'win' ? 2 : v.breakdown.terminal === 'loss' ? 0 : 1;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.breakdown.terminal === 'win') return b.terminalDistancePly! - a.terminalDistancePly!;
  if (a.breakdown.terminal === 'loss') return a.terminalDistancePly! - b.terminalDistancePly!;
  return a.breakdown.total === b.breakdown.total ? 0 : a.breakdown.total > b.breakdown.total ? 1 : -1;
}

export function exhaustive(s: BoardState, depth: number, q: number | null = null,
  root: Player = s.turn, ply = 0, reverse = false): ReferenceLeaf {
  const breakdown = evaluateSearchPositionBreakdown(s, root);
  const stand: ReferenceLeaf = { breakdown, pv: [],
    terminalDistancePly: breakdown.terminal === 'win' || breakdown.terminal === 'loss' ? ply : null,
    reason: s.result?.endReason ?? null };
  if (s.status === 'ended' || depth === 0 && (q === null || q === 0)) return stand;
  const tactical = depth === 0;
  const checked = tactical && isPlayerInCheck(s, s.turn);
  let actions = getLegalActions(s);
  if (tactical && !checked) actions = actions.filter(a => a.kind === 'move' && s.squares[a.to.row][a.to.col].piece !== null);
  if (reverse) actions.reverse();
  let best: ReferenceLeaf | null = tactical && !checked ? stand : null;
  for (const a of actions) {
    const v = exhaustive(apply(s,a), Math.max(0,depth-1), tactical ? q! - 1 : q, root, ply+1, reverse);
    const candidate = { ...v, pv: [a,...v.pv] };
    if (!best || (s.turn === root ? compareReference(candidate,best)>0 : compareReference(candidate,best)<0)) best = candidate;
  }
  return best ?? stand;
}

export function observePv(s: BoardState, pv: readonly LegalAction[], root = s.turn): ReferenceLeaf {
  let leaf = s;
  for (const a of pv) { assert.ok(getLegalActions(leaf).some(b => JSON.stringify(a) === JSON.stringify(b))); leaf = apply(leaf,a); }
  if (leaf.result?.endReason === 'checkmate' || leaf.result?.endReason === 'no_legal_actions') {
    const active = {...leaf, status: 'active' as const, result: null};
    assert.equal(getLegalActions(active).length,0);
    assert.equal(isPlayerInCheck(active,leaf.turn),leaf.result.endReason==='checkmate');
  }
  const breakdown = evaluateSearchPositionBreakdown(leaf,root);
  return { breakdown, pv: [...pv], terminalDistancePly: breakdown.terminal === 'win' || breakdown.terminal === 'loss' ? pv.length : null,
    reason: leaf.result?.endReason ?? null };
}
