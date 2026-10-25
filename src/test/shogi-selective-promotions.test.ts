import { describe, expect, it, vi } from 'vitest';
import { rankQuietPromotions, selectQuietPromotions } from '../domain/shogi/quietPromotionSelection';
import { analyzeQuiescenceSearch, analyzeQuiescenceSearchWithInternalBounds } from '../domain/shogi/quiescenceSearch';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { DEFAULT_MATERIAL_VALUE_TABLE as table } from '../domain/shogi/materialEvaluation';
import { getLegalActions, executeLegalAction, type LegalAction } from '../domain/shogi/legalActions';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import { SearchDiagnostics } from '../domain/shogi/searchDiagnostics';
import { SEARCH_BOTTOM, SEARCH_TOP } from '../domain/shogi/searchValue';
import { constructed, rotate, tacticalPositions } from '../../scripts/benchmarks/tacticalPositions';
import { exchangePositions } from '../../scripts/benchmarks/exchangePositions';
import { protectSearchInput } from '../domain/shogi/selfPlayGame';
import * as qModule from '../domain/shogi/quiescenceSearch';
import * as legal from '../domain/shogi/legalActions';
const selection = { maxCandidates: 1 };
const opts = { quiescence: { maxTacticalDepth: 1, selectiveQuietPromotions: selection } };
const base = { quiescence: { maxTacticalDepth: 1 } };
const evasion = () => tacticalPositions().find(p => p.id === 'evasion')!.state;
const rank = (s: ReturnType<typeof evasion>) => rankQuietPromotions(s,getLegalActions(s),table);
function replay(s: ReturnType<typeof evasion>, pv: readonly LegalAction[]) {
  for (const a of pv) { expect(getLegalActions(s)).toContainEqual(a); const r=executeLegalAction(s,a); if(r.type!=='applied') throw Error('illegal PV'); s=r.state; }
  return s;
}
const strip = ({ elapsedMilliseconds: _ms, ...r }: ReturnType<typeof analyzeAlphaBetaSearch>) => r;
describe('selective quiet promotions', () => {
  it('omitted/explicit OFF and all ON remain identical when selector is omitted', () => {
    for(const p of exchangePositions()) {
      expect(strip(analyzeAlphaBetaSearch(p.state,1,undefined,undefined,base))).toEqual(strip(analyzeAlphaBetaSearch(p.state,1,undefined,undefined,{quiescence:{...base.quiescence,includeQuietPromotions:false}})));
      const all={quiescence:{...base.quiescence,includeQuietPromotions:true}};
      expect(strip(analyzeAlphaBetaSearch(p.state,1,undefined,undefined,all))).toEqual(strip(analyzeAlphaBetaSearch(p.state,1,undefined,undefined,{quiescence:{...all.quiescence,selectiveQuietPromotions:undefined}})));
    }
  });
  it.each(['rook','bishop','pawn','silver','knight','lance'] as const)('uses actual gain for safe %s promotions', type => {
    const s=constructed(type,[[8,8,'king','sente'],[0,8,'king','gote'],[3,3,type,'sente']]);
    const chosen=selectQuietPromotions(s,getLegalActions(s),table,selection);
    expect(chosen).toHaveLength(1); expect(chosen[0].promotion).toBe('promote');
    expect(rank(s).find(r=>JSON.stringify(r.action)===JSON.stringify(chosen[0]))!.gain).toBe(table.promoted[type]-table.unpromoted[type]);
  });
  it('rejects exposed pawn, but retains a promotion defended against an equal pawn recapture', () => {
    const unsafe=constructed('unsafe',[[8,8,'king','sente'],[0,8,'king','gote'],[3,4,'pawn','sente'],[1,4,'gold','gote']]);
    expect(rank(unsafe)[0]).toMatchObject({gain:400,risk:600,score:-200,check:false});
    expect(selectQuietPromotions(unsafe,getLegalActions(unsafe),table,selection)).toEqual([]);
    const defended=constructed('defended',[[8,8,'king','sente'],[0,8,'king','gote'],[3,4,'pawn','sente'],[1,4,'pawn','gote'],[3,3,'gold','sente']]);
    expect(rank(defended)[0]).toMatchObject({gain:400,risk:400,score:0});
    // Zero estimated net gain is excluded; a richer recapturing piece makes it positive.
    defended.squares[1][4].piece!.type='silver';
    expect(rank(defended)[0].score).toBe(400);
    expect(selectQuietPromotions(defended,getLegalActions(defended),table,selection)).toHaveLength(1);
  });
  it('sees attacks exposed by vacating the source, without mutating input or regenerating legality', () => {
    const s=constructed('xray',[[8,8,'king','sente'],[0,8,'king','gote'],[2,4,'rook','sente'],[4,4,'rook','gote']]);
    const actions=getLegalActions(s), saved=structuredClone(s);
    const spy=vi.spyOn(legal,'getLegalActions');
    const ranks=rankQuietPromotions(s,actions,table);
    expect(ranks.find(r=>r.action.to.row===1&&r.action.to.col===4)!.risk).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();spy.mockRestore();expect(s).toEqual(saved);
  });
  it('keeps direct checking promotion and existing mate-distance, even when raw king attack rates it risky', () => {
    const s=constructed('mate',[[0,0,'king','gote'],[2,1,'king','sente'],[1,1,'pawn','sente'],[1,2,'gold','sente']]);
    expect(rank(s)[0].check).toBe(true);
    const r=analyzeQuiescenceSearchWithInternalBounds(s,s.turn,1,table,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,4,0,undefined,false,selection);
    expect(replay(s,r.principalVariation).result?.endReason).toBe('checkmate');
    expect(r.searchValue).toMatchObject({terminalDistancePly:5});
  });
  it('retains captures once, legal promotion/decline, stable cap ties, and rotated choices', () => {
    const s=constructed('multiple',[[8,8,'king','sente'],[0,8,'king','gote'],[3,2,'pawn','sente'],[3,4,'pawn','sente'],[3,6,'pawn','sente'],[2,6,'pawn','gote']]);
    const actions=getLegalActions(s);
    expect(actions.some(a=>a.to.col===2&&a.promotion==='decline')).toBe(true);
    const selected=selectQuietPromotions(s,actions,table,selection);
    expect(selected).toEqual(selectQuietPromotions(s,actions,table,selection));expect(selected[0].to.col).toBe(2);
    const entries:LegalAction[]=[];const diag=new SearchDiagnostics();diag.traceNode=e=>{if(e.kind==='enter'&&e.ply===1) entries.push(e.state.history.at(-1)! as LegalAction);};
    const r=analyzeQuiescenceSearchWithInternalBounds(s,s.turn,1,table,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',diag,0,0,undefined,false,selection);
    expect(r.visitedPositionCount).toBe(actions.filter(a=>a.kind==='move'&&s.squares[a.to.row][a.to.col].piece).length+1);
    const rot=rotate(s,'rot');expect(rank(rot).filter(r=>r.score>0&& !r.check).length).toBe(rank(s).filter(r=>r.score>0&&!r.check).length);
  });
  it.each([false,true])('keeps PR208 shallow correction for both sides (rotate=%s)', flip => {
    const s=flip?rotate(evasion(),'flip'):evasion();const r=analyzeAlphaBetaSearch(s,1,undefined,undefined,opts);
    expect(r.selectedAction).toEqual(analyzeAlphaBetaSearch(s,3,undefined,undefined,base).selectedAction);
    expect(r.evaluationBreakdown).toEqual(evaluateSearchPositionBreakdown(replay(s,r.principalVariation),s.turn));
  });
  it('checked nodes keep every legal evasion, while depth zero stops without selection', () => {
    const s=exchangePositions().find(p=>p.id==='gold-drop-evasion')!.state;
    const diag=new SearchDiagnostics();
    const r=analyzeQuiescenceSearchWithInternalBounds(s,s.turn,1,table,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',diag,0,0,undefined,false,selection);
    expect(r.visitedPositionCount).toBe(getLegalActions(s).length);expect(diag.phases['q-select-promotions'].calls).toBe(0);
    expect(analyzeQuiescenceSearch(s,s.turn,0,table,undefined,'original',0,undefined,false,selection).visitedPositionCount).toBe(0);
  });
  it('propagates interruption during selection; no input writes', () => {
    const {snapshot,wasMutated}=protectSearchInput(constructed('stop',[[8,8,'king','sente'],[0,8,'king','gote'],[3,3,'rook','sente']]));
    const error=Error('stop');let calls=0;
    expect(()=>rankQuietPromotions(snapshot,getLegalActions(snapshot),table,()=>{if(++calls===5)throw error;})).toThrow(error);
    expect(wasMutated()).toBe(false);
  });
  it('TT, PV hints and q ordering preserve selected values and protected input', () => {
    const {snapshot,wasMutated}=protectSearchInput(evasion());
    const expected=analyzeAlphaBetaSearch(snapshot,2,undefined,undefined,opts);
    for(const cap of [1,2]) for(const tt of [false,true]) {
      const options={...opts,useTranspositionTable:tt,usePreviousIterationPv:true,quiescence:{...opts.quiescence,moveOrdering:'material' as const,selectiveQuietPromotions:{maxCandidates:cap}}};
      const r=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(snapshot,2,1000,undefined,()=>0,options);
      expect(r.selectedAction).toEqual(expected.selectedAction);expect(r.selectedEvaluation).toBe(expected.selectedEvaluation);
      replay(snapshot,r.principalVariation);
    }
    expect(wasMutated()).toBe(false);
  });
  it('preserves partial-root, fallback and last completed iteration under controlled deadlines', () => {
    const s=evasion();let calls=0;const real=qModule.analyzeQuiescenceSearchWithInternalBounds;
    const spy=vi.spyOn(qModule,'analyzeQuiescenceSearchWithInternalBounds').mockImplementation((...args)=>{calls++;return real(...args);});
    try {
      const fixed=analyzeAlphaBetaSearch(s,1,undefined,undefined,opts),firstCalls=calls;
      calls=0;const partial=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,4,100,undefined,()=>calls>=2?100:0,opts);
      expect(partial.resultSource).toBe('partial-root');expect(partial.partialRoot!.exactRootCandidateCount).toBeGreaterThan(0);
      replay(s,partial.principalVariation);
      calls=0;const completed=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,4,100,undefined,()=>calls>firstCalls?100:0,opts);
      expect(completed.resultSource).toBe('completed-iteration');expect(completed.principalVariation).toEqual(fixed.principalVariation);
      const fallback=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,4,0,undefined,()=>0,opts);
      expect(fallback).toMatchObject({resultSource:'fallback',completedDepth:0,selectedEvaluation:null,principalVariation:[]});
    } finally {spy.mockRestore();}
  });
  it.each([null,{},[],{maxCandidates:0},{maxCandidates:1.5},{maxCandidates:Infinity},{maxCandidates:1,other:1}])('rejects invalid selector %j', value => {
    expect(()=>analyzeAlphaBetaSearch(evasion(),1,undefined,undefined,{quiescence:{maxTacticalDepth:1,selectiveQuietPromotions:value as never}})).toThrow(/maxCandidates/);
  });
  it('rejects contradictory all/selective options',()=>{expect(()=>analyzeAlphaBetaSearch(evasion(),1,undefined,undefined,{quiescence:{...opts.quiescence,includeQuietPromotions:true}})).toThrow(/both/);});
});
