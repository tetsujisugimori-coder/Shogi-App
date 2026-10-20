import { constructed, type Placement } from './benchmarks/tacticalPositions';
import { getLegalActions, executeLegalAction } from '../src/domain/shogi/legalActions';
import { isPlayerInCheck } from '../src/domain/shogi/checkmate';
import type { BoardState } from '../src/types/shogi';

// Fixture discovery only. All decisive adjudications count; no evaluator,
// alpha/beta, quiescence, engine ordering, or checkmate-only objective.
function distance(s: BoardState, depth: number): number | null {
  if (s.status === 'ended') return s.result?.winner === 'sente' ? 0 : null;
  if (!depth) return null;
  const values = getLegalActions(s).map(a => {
    const e = executeLegalAction(s, a);
    if (e.type !== 'applied') throw Error('execution');
    return distance(e.state, depth - 1);
  });
  if (!values.length) return null;
  if (s.turn === 'sente') {
    const wins = values.filter((v): v is number => v !== null);
    return wins.length ? 1 + Math.min(...wins) : null;
  }
  return values.every(v => v !== null) ? 1 + Math.max(...values as number[]) : null;
}
let tested = 0;
outer: for (const kr of [2,3]) for (const kc of [0,1,2])
for (let a = 9; a < 39; a++) for (let b = a + 1; b < 40; b++) {
  const placements: Placement[] = [[0,1,'king','gote'], [kr,kc,'king','sente'],
    [Math.floor(a / 9),a % 9,'gold','sente'],[Math.floor(b / 9),b % 9,'gold','sente']];
  if (new Set(placements.map(([r,c]) => r*9+c)).size !== 4) continue;
  const s = constructed('resistance-discovery', placements, 'gote');
  if (isPlayerInCheck(s, 'sente')) continue;
  const actions = getLegalActions(s);
  if (actions.length < 2 || actions.length > 3) continue;
  const values = actions.map(a => {
    const e = executeLegalAction(s,a);
    if (e.type !== 'applied') throw Error('fixture');
    const d = distance(e.state,3);
    return d === null ? null : d + 1;
  });
  tested++;
  if (values.every(v => v !== null) && new Set(values).size > 1) {
    console.log(JSON.stringify({placements,actions,values,tested})); break outer;
  }
  if (tested % 100 === 0) console.error({tested});
}
