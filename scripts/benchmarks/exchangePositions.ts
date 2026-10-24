import { QUIESCENCE_BENCHMARK_POSITIONS } from './quiescencePositions';
import { constructed, rotate, tacticalPositions, type Placement } from './tacticalPositions';
import { createSeeDeadlinePosition } from './seeDeadlinePosition';

/** Reuse existing legal fixtures; sparse problems do not claim hirate reachability. */
export function exchangePositions() {
  const kings: Placement[] = [[8,8,'king','sente'],[0,8,'king','gote']];
  const chain = constructed('exchange-chain', [...kings,
    [5,4,'rook','sente'],[4,4,'pawn','gote'],[3,4,'silver','gote'],[5,5,'gold','sente']]);
  const evasion = tacticalPositions().find(p => p.id === 'evasion')!;
  return [
    ...QUIESCENCE_BENCHMARK_POSITIONS.map(p => ({ id:p.id, state:p.create(), reason:p.observation })),
    { id:'exchange-chain', state:chain, reason:'Rook captures pawn, silver recaptures rook, gold recaptures silver: the material delta is +200 / -1800 / -1000.' },
    { id:'evasion-promotion', state:evasion.state, reason:'PR #208: after king evasion the opponent can promote a rook without capture.' },
    { id:'evasion-promotion-gote', state:rotate(evasion.state,'evasion-promotion-gote'), reason:'Rotated PR #208 boundary, opposite perspective.' },
    { id:'see-deadline', state:createSeeDeadlinePosition(), reason:'Existing branching SEE deadline fixture, multiple recaptures and opened lance.' },
  ];
}
