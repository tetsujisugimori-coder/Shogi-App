import { it, expect, vi } from 'vitest';
import { ExactTranspositionTable } from '../domain/shogi/transpositionTable';
import { analyzeAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { analyzeQuiescenceSearch, analyzeQuiescenceSearchWithInternalBounds } from '../domain/shogi/quiescenceSearch';
import { rankQuietPromotions,selectQuietPromotions } from '../domain/shogi/quietPromotionSelection';
import { DEFAULT_MATERIAL_VALUE_TABLE as table } from '../domain/shogi/materialEvaluation';
import { getLegalActions } from '../domain/shogi/legalActions';
import { constructed, rotate, tacticalPositions } from '../../scripts/benchmarks/tacticalPositions';
import { SEARCH_BOTTOM, SEARCH_TOP, numericalSearchBound } from '../domain/shogi/searchValue';
import { SearchDiagnostics } from '../domain/shogi/searchDiagnostics';
it('TT identity carries the complete resolved selector, distinct from OFF and all',()=>{
  const s=tacticalPositions().find(p=>p.id==='evasion')!.state;
  for(const promotionOptions of [{includeQuietPromotions:false},{includeQuietPromotions:true},{selectiveQuietPromotions:{maxCandidates:1}},{selectiveQuietPromotions:{maxCandidates:2}}]) {
    const spy=vi.spyOn(ExactTranspositionTable.prototype,'store');
    try {
      analyzeAlphaBetaSearch(s,2,undefined,undefined,{useTranspositionTable:true,quiescence:{maxTacticalDepth:1,...promotionOptions}});
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for(const call of spy.mock.calls) {
        const q=JSON.parse(call[1])[2];
        expect(q.includeQuietPromotions).toBe('includeQuietPromotions' in promotionOptions?promotionOptions.includeQuietPromotions:false);
        expect(q.selectiveQuietPromotions).toEqual('selectiveQuietPromotions' in promotionOptions?promotionOptions.selectiveQuietPromotions:undefined);
      }
    } finally {spy.mockRestore();}
  }
});
it('mandatory promotion and single-candidate rotation follow the legal enumerator',()=>{
  const s=constructed('forced',[[8,8,'king','sente'],[0,8,'king','gote'],[1,4,'pawn','sente']]);
  for(const state of [s,rotate(s,'reverse')]) {
    const actions=getLegalActions(state), chosen=selectQuietPromotions(state,actions,table,{maxCandidates:1});
    expect(chosen).toHaveLength(1);expect(chosen[0].promotion).toBe('promote');
    expect(actions.some(a=>a.pieceType==='pawn'&&a.promotion==='decline')).toBe(false);
    expect(chosen[0].to.row).toBe(state.turn==='sente'?0:8);
  }
});
it('custom material gain changes ranking without changing the evaluation table',()=>{
  const s=constructed('values',[[8,8,'king','sente'],[0,8,'king','gote'],[3,2,'pawn','sente'],[3,4,'silver','sente']]);
  const custom={unpromoted:{...table.unpromoted},promoted:{...table.promoted,pawn:101,silver:900}};
  expect(rankQuietPromotions(s,getLegalActions(s),table)[0].action.pieceType).toBe('pawn');
  expect(rankQuietPromotions(s,getLegalActions(s),custom)[0].action.pieceType).toBe('silver');
});
it('q0 evasion cap and q1 stand-pat window retain existing bounds',()=>{
  const checked=tacticalPositions().find(p=>p.id==='evasion')!.state;
  const a=analyzeQuiescenceSearch(checked,checked.turn,0,table,undefined,'original',1);
  const c=analyzeQuiescenceSearch(checked,checked.turn,0,table,undefined,'original',1,undefined,false,{maxCandidates:1});
  expect(c).toEqual(a);
  const s=constructed('window',[[8,8,'king','sente'],[0,8,'king','gote'],[3,3,'pawn','sente']]);
  const d=new SearchDiagnostics();
  const r=analyzeQuiescenceSearchWithInternalBounds(s,s.turn,1,table,undefined,SEARCH_BOTTOM,numericalSearchBound(-100000),'original',d,0,0,undefined,false,{maxCandidates:1});
  expect(r.visitedPositionCount).toBe(0);expect(r.cutoffCount).toBe(1);expect(r.principalVariation).toEqual([]);
  const full=analyzeQuiescenceSearchWithInternalBounds(s,s.turn,1,table,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,0,0,undefined,false,{maxCandidates:1});
  expect(full.principalVariation).toHaveLength(1);
});
