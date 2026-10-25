import { constructed, rotate, tacticalPositions, type Placement } from './tacticalPositions';
import { exchangePositions } from './exchangePositions';
import { normalizePositionHistory } from '../../src/domain/shogi/repetition';
import { normalizePositionSnapshots } from '../../src/domain/shogi/replay';

/** Artificial influence controls; never claimed reachable from hirate. */
export function pieceSafetyPositions() {
  const kings: Placement[] = [[8,8,'king','sente'],[0,8,'king','gote']];
  const controls = [
    {id:'unprotected',pieces:[[4,4,'rook','sente'],[3,4,'pawn','gote']] as Placement[]},
    {id:'two-one',pieces:[[4,4,'rook','sente'],[3,4,'pawn','gote'],[4,0,'rook','gote'],[5,4,'gold','sente']] as Placement[]},
    {id:'one-two',pieces:[[4,4,'rook','sente'],[3,4,'pawn','gote'],[5,4,'gold','sente'],[5,3,'silver','sente']] as Placement[]},
    {id:'pinned-defender',pieces:[[8,4,'king','sente'],[0,8,'king','gote'],[0,4,'rook','gote'],[5,4,'gold','sente'],[4,3,'rook','sente'],[3,3,'pawn','gote']] as Placement[]},
  ].flatMap(c=>{
    const state=constructed(c.id,c.id==='pinned-defender'?c.pieces:[...kings,...c.pieces]);
    return [{id:c.id,state,origin:'constructed raw influence control'},
      {id:c.id+'-gote',state:rotate(state,c.id+'-gote'),origin:'constructed rotated raw influence control'}];
  });
  return [...controls,...exchangePositions().map(p=>({...p,
    state:normalizePositionSnapshots(normalizePositionHistory(p.state)),
    origin:'existing exchange/SEE/q fixture (initial history normalized): '+p.reason})),
    ...tacticalPositions().map(p=>({id:'tactical-'+p.id,state:p.state,origin:p.origin}))];
}
