import { mkdirSync, writeFileSync } from 'node:fs';
import { pieceSafetyPositions } from './benchmarks/pieceSafetyPositions';
import { createAttackCountMaps, getAttackCount } from '../src/domain/shogi/attacks';
import { DEFAULT_MATERIAL_VALUE_TABLE, getBoardPieceMaterialValue } from '../src/domain/shogi/materialEvaluation';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { analyzeAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { evaluateStaticExchange } from '../src/domain/shogi/staticExchangeEvaluation';
const dir=process.argv[2];mkdirSync(dir,{recursive:false});
for(const p of pieceSafetyPositions()) {
  const s=p.state,m=createAttackCountMaps(s.squares),actions=getLegalActions(s);
  const pieces=s.squares.flatMap(row=>row.flatMap(sq=>sq.piece&&sq.piece.type!=='king'?[{
    square:{row:sq.row,col:sq.col},piece:sq.piece,value:getBoardPieceMaterialValue(sq.piece,DEFAULT_MATERIAL_VALUE_TABLE),
    attackers:getAttackCount(m,sq,sq.piece.player==='sente'?'gote':'sente'),defenders:getAttackCount(m,sq,sq.piece.player),
  }]:[]));
  const result={...p,legalActions:actions,pieces,breakdown:evaluateSearchPositionBreakdown(s,s.turn),
    shallow:analyzeAlphaBetaSearch(s,1),deep:analyzeAlphaBetaSearch(s,3),
    exchanges:actions.filter(a=>a.kind==='move'&&s.squares[a.to.row][a.to.col].piece).map(action=>({action,see:evaluateStaticExchange(s,action)})),
    limitation:'Raw counts include pins; SEE restricts continuation to one target. d3 is finite reference, never a whole-game proof.'};
  writeFileSync(dir+'/'+p.id+'.json',JSON.stringify(result)+'\n',{flag:'wx'});
}
