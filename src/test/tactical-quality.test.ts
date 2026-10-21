import { describe,it,expect } from 'vitest';
import { qualityPositions,loadPositions,qualityReference,qualityClassify,auditQualityResult,aggregateQuality } from '../../scripts/benchmarks/tacticalQuality';
import { hash,json,parse } from '../../scripts/benchmarks/tacticalDiagnostics';
import { analyzeAlphaBetaSearch as fixed,analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions } from '../domain/shogi/legalActions';
const ps=qualityPositions(), p=ps.find(p=>p.id==='mixed-distance')!;
const opts={moveOrdering:'standard' as const,killerMoves:false,usePreviousIterationPv:false,useTranspositionTable:false,
  quiescence:{maxTacticalDepth:1,moveOrdering:'original' as const,maxCheckEvasionExtensions:0}};
const result=()=>fixed(p.state,1,undefined,undefined,opts);
describe('tactical quality diagnostic evidence',()=>{
  it('loads frozen 16 positions and two legal-history continuations without mutation',()=>{
    const before=hash(ps); expect(loadPositions(parse(json(ps)))).toEqual(ps); expect(qualityPositions()).toEqual(ps);
    expect(ps).toHaveLength(16); expect(ps.at(-1)!.state.history).toHaveLength(8); expect(hash(ps)).toBe(before);
    expect(ps.find(p=>p.id==='hirate-exchange')!.state.senteHand.length).toBeGreaterThan(0);
  });
  it('rejects null, empty, duplicate, missing king and corrupt history',()=>{
    for(const v of [null,[],[p,p]]) expect(()=>loadPositions(v)).toThrow();
    const bad=structuredClone(p);bad.state.positionHistory=[];expect(()=>loadPositions([bad])).toThrow();
    const king=structuredClone(p);king.state.squares[0][0].piece=null;expect(()=>loadPositions([king])).toThrow();
    const history=structuredClone(ps.at(-1)!);history.state.history[0].to={row:0,col:0};expect(()=>loadPositions([history])).toThrow();
  });
  it.each(['mate-sente','mate-gote'])('keeps root-relative terminal signs for %s',id=>{
    const pos=ps.find(p=>p.id===id)!,r=fixed(pos.state,1,undefined,undefined,opts);
    expect(r.selectedEvaluation).toBe(Infinity);expect(auditQualityResult(pos,r,0)!.terminalDistancePly).toBe(1);
  });
  it('checks multiple legal evasions, both sides and all 0/1/2 extension PVs',()=>{
    for(const pos of ps.filter(p=>p.id.startsWith('countercheck'))) {
      expect(getLegalActions(pos.state).length).toBeGreaterThan(1);
      for(const extra of [0,1,2]) auditQualityResult(pos,fixed(pos.state,1,undefined,undefined,{...opts,quiescence:{...opts.quiescence,maxCheckEvasionExtensions:extra}}),extra);
    }
  });
  it('rejects illegal selected action and invalid PV/breakdown',()=>{
    const r=result();expect(()=>auditQualityResult(p,{...r,selectedAction:{kind:'bad'} as never},0)).toThrow();
    expect(()=>auditQualityResult(p,{...r,principalVariation:[]},0)).toThrow();
    expect(()=>auditQualityResult(p,{...r,selectedEvaluation:12},0)).toThrow();
  });
  it('uses full width and reverse traversal, preserving deterministic input',()=>{
    const before=hash(p),ref=qualityReference(p,2,6000);
    expect(ref.stopped).toBe(false);expect(ref.reverseVerified).toBe(true);expect(qualityReference(p,2,6000)).toEqual(ref);expect(hash(p)).toBe(before);
  });
  it('never promotes limited reference or fallback into an error',()=>{
    const ref=qualityReference(p,3,1);expect(ref.stopped).toBe(true);expect(qualityClassify(p,ref,result()).quality).toBe('Inconclusive');
    expect(qualityClassify(p,ref,null).quality).toBe('Inconclusive');
    expect(qualityClassify(p,ref,{...result(),selectedEvaluation:null}).quality).toBe('Inconclusive');
  });
  it('does not treat multiple equally good moves as errors',()=>{
    const ref=qualityReference(p,1),r=result();
    const wins=ref.candidates.filter(c=>c.value.breakdown.terminal==='win');expect(wins.length).toBeGreaterThan(1);
    for(const c of wins) expect(qualityClassify(p,ref,{...r,selectedAction:c.action}).quality).toBe('NoObservedDifference');
  });
  it('separates finite horizon preference from fully terminal proof (classifier fixture only)',()=>{
    const ref=qualityReference(p,1),r=result();
    const best=ref.candidates.find(c=>c.value.breakdown.terminal==='win')!;
    const chosen=ref.candidates.find(c=>c.value.breakdown.terminal===null)!;
    expect(chosen).toBeDefined();
    const selected={...r,selectedAction:chosen.action};
    expect(qualityClassify(p,ref,selected).quality).toBe('QualityGap');
    // Deliberately fabricated closed losing candidate tests classifier policy, not engine weakness.
    chosen.closed=true;chosen.value={...best.value,breakdown:{...best.value.breakdown,terminal:'loss',total:-Infinity}};
    const verdict=qualityClassify(p,ref,selected);expect(verdict.quality).toBe('ProvenError');expect(verdict.evidence).toContain('all-terminal');
  });
  it('rejects references from a different input',()=>{
    const ref=qualityReference(p,1);expect(()=>qualityClassify({...p,id:'wrong'},ref,result())).toThrow();
  });
  it.each([100,1000])('records actual %ims result with completed depth/source and legal PV',budget=>{
    const pos=ps.find(p=>p.id==='single-evasion')!,r=timed(pos.state,1,budget,undefined,undefined,opts);
    expect(r.completedDepth).toBeGreaterThanOrEqual(0);expect(['completed-iteration','partial-root','fallback']).toContain(r.resultSource);
    auditQualityResult(pos,r,0);
  });
  it('audits fallback and partial-root shapes without equating completed depths',()=>{
    const r=result();
    expect(auditQualityResult(p,{...r,resultSource:'fallback',selectedEvaluation:null,evaluationBreakdown:null,principalVariation:[]} as never,0)).toBeNull();
    expect(()=>auditQualityResult(p,{...r,resultSource:'completed',selectedEvaluation:null} as never,0)).toThrow();
    expect(()=>auditQualityResult(p,{...r,resultSource:'fallback',selectedEvaluation:null,principalVariation:[]} as never,0)).toThrow();
    const part={...r,resultSource:'partial-root',depth:0,completedDepth:0};expect(auditQualityResult(p,part as never,0)).not.toBeNull();
  });
  it('regenerates aggregates, preserves equivalent actions and reports depth differences',()=>{
    const r=result(),row={position:p.id,condition:'100ms',rep:0,quality:'NoObservedDifference' as const,callMs:101,overrunMs:1,result:r};
    const rows=[{...row,extra:0},{...row,extra:1},{...row,extra:2,result:{...r,depth:0,selectedAction:getLegalActions(p.state).find(a=>json(a)!==json(r.selectedAction))!}}];
    const a=aggregateQuality([p],rows);expect(aggregateQuality([p],parse(json(rows)))).toEqual(a);
    expect(aggregateQuality([p],rows.slice(1)).unpaired).toHaveLength(2);
    expect(a.differences).toHaveLength(1);expect(a.firstDifference).toMatchObject({baselineDepth:1,depth:0});
  });
  it('audits real cooperative fallback and partial-root with a controlled clock',()=>{
    for(const boundary of [4,7]) {
      let reads=0;
      const r=timed(p.state,1,100,undefined,()=>++reads>=boundary?100:0,{...opts,quiescence:{...opts.quiescence,maxTacticalDepth:0}});
      expect(r.resultSource).toBe(boundary===4?'fallback':'partial-root');auditQualityResult(p,r,0);
    }
  });
  it('repeats fixed search deterministically without mutating input',()=>{
    const before=hash(p),a=result(),b=result();expect({...a,elapsedMilliseconds:0}).toEqual({...b,elapsedMilliseconds:0});expect(hash(p)).toBe(before);
  });
});
