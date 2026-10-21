import { constructed, rotate, tacticalPositions, type TacticalPosition } from './tacticalPositions';

// Fixed before any A/B/C outcomes. Sparse problems omit unused material;
// only hirate-exchange claims reachability from the initial position.
export function checkEvasionPositions(): TacticalPosition[] {
  const chain = constructed('countercheck', [[8,4,'king','sente'],[4,8,'king','gote'],
    [4,4,'rook','gote'],[4,0,'rook','sente']]);
  const single = constructed('single-evasion', [[8,8,'king','sente'],[6,6,'king','gote'],[6,8,'rook','gote']]);
  const base = (id: string, state: typeof chain): TacticalPosition => ({ id, state,
    origin: 'constructed; missing pieces outside problem; hirate reachability not claimed',
    purpose: 'q boundary check evasions and counterchecks', expectation: 'avoid-loss',
    referenceWinner: state.turn === 'sente' ? 'gote' : 'sente', referenceDepth: 3 });
  return [...tacticalPositions(), base('countercheck', chain),
    base('countercheck-gote', rotate(chain, 'countercheck-gote')),
    base('single-evasion', single), base('single-evasion-gote', rotate(single, 'single-evasion-gote'))];
}
