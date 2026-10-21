import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkEvasionPositions } from '../../scripts/benchmarks/checkEvasionPositions';
import { evasionReference } from '../../scripts/benchmarks/checkEvasionReference';
import { apply, compareReference, observePv } from '../../scripts/benchmarks/terminalDistanceReference';
import { parse } from '../../scripts/benchmarks/tacticalDiagnostics';
import { constructed, rotate } from '../../scripts/benchmarks/tacticalPositions';
import * as q from '../domain/shogi/quiescenceSearch';
import { analyzeAlphaBetaSearch as fixed, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions } from '../domain/shogi/legalActions';
import { isPlayerInCheck } from '../domain/shogi/checkmate';
import { createTranspositionTableStatistics } from '../domain/shogi/transpositionTable';
import { SEARCH_BOTTOM, SEARCH_TOP } from '../domain/shogi/searchValue';

const positions = checkEvasionPositions();
const find = (id: string) => positions.find(p=>p.id===id)!.state;
const opts = (extra: number, stats = q.createCheckEvasionStatistics()) => ({ checkEvasionStatistics:stats,
  quiescence:{maxTacticalDepth:1, maxCheckEvasionExtensions:extra, moveOrdering:'original' as const} });
const strip = <T extends { elapsedMilliseconds: number }>(r:T) => ({...r,elapsedMilliseconds:0});
afterEach(()=>vi.restoreAllMocks());

describe('bounded check evasions',()=>{
  it.each(positions.map(p=>p.id))('preserves recorded unmodified-main q0/1/2 and explicit zero: %s',id=>{
    const baseline=parse(readFileSync('docs/benchmarks/check-evasion-20261021/baseline.json','utf8'));
    const s=find(id);
    for (const depth of [0,1,2]) {
      const old=baseline.rows.find((r:{id:string})=>r.id===id).q[depth];
      expect(q.analyzeQuiescenceSearch(s,s.turn,depth)).toEqual(old);
      expect(q.analyzeQuiescenceSearch(s,s.turn,depth,undefined,undefined,'original',0)).toEqual(old);
    }
    expect(strip(fixed(s,1,undefined,undefined,{quiescence:{maxTacticalDepth:1}}))).toEqual(strip(fixed(s,1,undefined,undefined,opts(0))));
    const alphaBaseline=parse(readFileSync('docs/benchmarks/check-evasion-20261021/baseline-alpha-beta.json','utf8'));
    for(const depth of [1,2]) expect(strip(fixed(s,depth,undefined,undefined,{quiescence:{maxTacticalDepth:1}})))
      .toEqual(alphaBaseline.rows.find((r:{id:string})=>r.id===id).results[depth-1]);
  });
  it.each([0,1,2])('matches independent full-width and reverse-order reference, extra %i',extra=>{
    for (const id of ['evasion','single-evasion','single-evasion-gote','countercheck','countercheck-gote','recapture']) {
      const s=find(id), before=structuredClone(s);
      for (const depth of [0,1]) {
        const r=q.analyzeQuiescenceSearch(s,s.turn,depth,undefined,undefined,'original',extra);
        const observed=observePv(s,r.principalVariation);
        const ref=evasionReference(s,0,depth,extra);
        expect(r.evaluationBreakdown).toEqual(ref.breakdown);
        expect(r.evaluationBreakdown).toEqual(observed.breakdown);
        expect(r.selectedEvaluation).toBe(r.evaluationBreakdown.total);
        expect(compareReference(observed,evasionReference(s,0,depth,extra,s.turn,0,true))).toBe(0);
      }
      expect(s).toEqual(before);
    }
  });
  it('does not extend an ordinary depth-zero position even with captures',()=>{
    const s=find('recapture'), stats=q.createCheckEvasionStatistics();
    expect(q.analyzeQuiescenceSearch(s,s.turn,0,undefined,undefined,'original',2,stats))
      .toEqual(q.analyzeQuiescenceSearch(s,s.turn,0));
    expect(stats).toEqual(q.createCheckEvasionStatistics());
  });
  it('visits every evasion in an open window; the best need not be first',()=>{
    const s=find('countercheck'), stats=q.createCheckEvasionStatistics();
    const r=q.analyzeQuiescenceSearch(s,s.turn,0,undefined,undefined,'original',1,stats);
    expect(r.visitedPositionCount).toBe(getLegalActions(s).length);
    expect(stats.visitedPositionCount).toBe(getLegalActions(s).length);
    const ref=evasionReference(s,0,0,1); expect(r.principalVariation).toEqual(ref.pv);
    const single=find('single-evasion');
    expect(getLegalActions(single)).toHaveLength(1);
    expect(q.analyzeQuiescenceSearch(single,single.turn,0,undefined,undefined,'original',1).principalVariation[0])
      .toEqual(getLegalActions(single)[0]);
  });
  it('bounds counterchecks separately from ordinary tactical depth and marks approximation',()=>{
    const s=find('countercheck');
    for (const extra of [1,2]) {
      const stats=q.createCheckEvasionStatistics();
      const r=q.analyzeQuiescenceSearchWithInternalBounds(s,s.turn,0,{},undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,0,extra,stats);
      expect(stats.maxExtensionDepth).toBe(extra);
      expect(r.principalVariation.length).toBeLessThanOrEqual(extra);
      if(extra===1) { expect(stats.limitReachedCount).toBeGreaterThan(0); expect(r.checkEvasionLimitReached).toBe(true); }
    }
  });
  it('adjudicates a checked custom root without responses, and already-ended children',()=>{
    const s=constructed('mated',[[0,0,'king','gote'],[2,1,'king','sente'],[1,0,'gold','sente']], 'gote');
    expect(isPlayerInCheck(s,s.turn)).toBe(true); expect(getLegalActions(s)).toHaveLength(0);
    for(const state of [s,rotate(s,'mated-rotated')]) {
      const r=q.analyzeQuiescenceSearch(state,state.turn,0,undefined,undefined,'original',1);
      expect(r.evaluationBreakdown.terminal).toBe('loss'); expect(r.selectedEvaluation).toBe(-Infinity);
      expect(r.principalVariation).toEqual([]);
    }
    const mate=find('mate-sente');
    const end=getLegalActions(mate).map(a=>apply(mate,a)).find(s=>s.status==='ended')!;
    expect(end).toBeDefined(); expect(q.analyzeQuiescenceSearch(end,mate.turn,0,undefined,undefined,'original',2).selectedEvaluation).toBe(Infinity);
  });
  it('preserves alpha/beta fail bounds and prunes unvisited alternatives',()=>{
    const s=find('evasion');
    const full=q.analyzeQuiescenceSearch(s,s.turn,0,undefined,undefined,'original',1);
    const failHigh=q.analyzeQuiescenceSearchWithinBounds(s,s.turn,0,{},undefined,-Infinity,-100000,'original',undefined,1);
    expect(failHigh.selectedEvaluation).toBeGreaterThanOrEqual(-100000);
    expect(failHigh.skippedActionCount).toBeGreaterThan(0);
    const failLow=q.analyzeQuiescenceSearchWithinBounds(s,s.turn,0,{},undefined,full.selectedEvaluation,Infinity,'original',undefined,1);
    expect(failLow.selectedEvaluation).toBe(full.selectedEvaluation);
    const min=q.analyzeQuiescenceSearchWithinBounds(s,s.turn==='sente'?'gote':'sente',0,{},undefined,100000,Infinity,'original',undefined,1);
    expect(min.skippedActionCount).toBeGreaterThan(0);
  });
  it.each([1,2])('keeps terminal distances and fixed-search PV/evaluation, extra %i',extra=>{
    for (const id of ['mixed-distance','resistance','single-evasion','single-evasion-gote']) {
      const s=find(id), depth=id==='resistance'?3:1;
      const r=fixed(s,depth,undefined,undefined,opts(extra));
      const observed=observePv(s,r.principalVariation);
      const ref=evasionReference(s,depth,1,extra);
      expect(compareReference(observed,ref)).toBe(0);
      expect(r.evaluationBreakdown).toEqual(observed.breakdown);
      expect(r.selectedAction).toEqual(r.principalVariation[0]);
    }
  });
  it.each([-1,0.5,3,100,NaN,Infinity,-Infinity,null,'1',true])('rejects invalid extension %s',value=>{
    const extra=value as number;
    expect(()=>q.analyzeQuiescenceSearch(find('evasion'),'sente',0,undefined,undefined,'original',extra)).toThrow(RangeError);
    expect(()=>fixed(find('evasion'),1,undefined,undefined,opts(extra))).toThrow(RangeError);
    expect(()=>timed(find('evasion'),1,0,undefined,undefined,opts(extra))).toThrow(RangeError);
  });
  it('TT ON safely bypasses reuse when enabled and leaves result/statistics identical',()=>{
    const s=find('countercheck'), tt=createTranspositionTableStatistics();
    const a=fixed(s,2,undefined,undefined,opts(2));
    const b=fixed(s,2,undefined,undefined,{...opts(2),useTranspositionTable:true,transpositionTableStatistics:tt});
    expect(strip(a)).toEqual(strip(b)); expect(tt.safetyRejects).toBeGreaterThan(0);
    expect(tt.lookups).toBe(0); expect(tt.stores).toBe(0); expect(tt.exactReuses).toBe(0);
  });
  it('propagates interruption at every extra-search cooperative boundary',()=>{
    const s=find('countercheck'); let count=0;
    q.analyzeQuiescenceSearch(s,s.turn,0,undefined,()=>{count++;},'original',2);
    const before=structuredClone(s), sentinel=Error('test-interruption');
    for (let stop=1;stop<=count;stop++) { let calls=0;
      expect(()=>q.analyzeQuiescenceSearch(s,s.turn,0,undefined,()=>{if(++calls===stop)throw sentinel;},'original',2)).toThrow(sentinel);
    }
    expect(s).toEqual(before);
  });
  it('uses fallback when the first extended candidate is interrupted',()=>{
    const s=find('countercheck'), stats=q.createCheckEvasionStatistics();
    const r=timed(s,4,100,undefined,()=>stats.visitedPositionCount>0?100:0,
      {...opts(2,stats),quiescence:{maxTacticalDepth:0,maxCheckEvasionExtensions:2}});
    expect(stats.visitedPositionCount).toBeGreaterThan(0);
    expect(r).toMatchObject({resultSource:'fallback',completedDepth:0,timedOut:true,selectedEvaluation:null,principalVariation:[]});
  });
  it('retains only previously completed exact candidates when extension is interrupted',()=>{
    const s=find('mate-sente'), stats=q.createCheckEvasionStatistics();
    const r=timed(s,4,100,undefined,()=>stats.visitedPositionCount>0?100:0,
      {...opts(2,stats),quiescence:{maxTacticalDepth:0,maxCheckEvasionExtensions:2}});
    expect(r.resultSource).toBe('partial-root'); expect(r.completedDepth).toBe(0);
    expect(r.partialRoot!.exactRootCandidateCount).toBeGreaterThan(0);
    expect(observePv(s,r.principalVariation).breakdown).toEqual(r.evaluationBreakdown);
  });
  it('excludes returned capped approximations from partial-root exact candidates',()=>{
    const s=find('countercheck'); let returned=0;
    const real=q.analyzeQuiescenceSearchWithInternalBounds;
    vi.spyOn(q,'analyzeQuiescenceSearchWithInternalBounds').mockImplementation((...args)=>{
      const r=real(...args); returned++; return {...r,checkEvasionLimitReached:true};
    });
    const r=timed(s,1,100,undefined,()=>returned>=2?100:0,opts(1));
    expect(returned).toBe(2);
    expect(r.resultSource).toBe('fallback');
  });
  it('prefers a completed iteration over an interrupted deeper extension',()=>{
    const s=find('single-evasion'); let calls=0;
    const real=q.analyzeQuiescenceSearchWithInternalBounds;
    const spy=vi.spyOn(q,'analyzeQuiescenceSearchWithInternalBounds').mockImplementation((...args)=>{calls++;return real(...args);});
    const first=fixed(s,1,undefined,undefined,opts(2)); const depthOneCalls=calls;
    expect(depthOneCalls).toBeGreaterThan(0); calls=0;
    const r=timed(s,4,100,undefined,()=>calls>depthOneCalls?100:0,opts(2));
    expect(spy).toHaveBeenCalled();
    expect(r).toMatchObject({resultSource:'completed-iteration',completedDepth:1,timedOut:true});
    expect(r.selectedAction).toEqual(first.selectedAction); expect(r.principalVariation).toEqual(first.principalVariation);
  });
});
