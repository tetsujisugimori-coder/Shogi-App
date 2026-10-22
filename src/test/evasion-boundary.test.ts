import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {diagnose,aggregate,limits,settings,bound,rootScore,replay} from '../../scripts/benchmarks/evasionBoundary';
import {parse,hash,apply,json} from '../../scripts/benchmarks/tacticalDiagnostics';
import {evasionReference} from '../../scripts/benchmarks/checkEvasionReference';
import {compareReference} from '../../scripts/benchmarks/terminalDistanceReference';
import {constructed,rotate} from '../../scripts/benchmarks/tacticalPositions';
import {analyzeAlphaBetaSearch} from '../domain/shogi/twoPlyAlphaBetaAi';
import {SearchDiagnostics} from '../domain/shogi/searchDiagnostics';
import {getLegalActions} from '../domain/shogi/legalActions';
import {evaluateSearchPositionBreakdown} from '../domain/shogi/twoPlyMinimaxAi';
import {resolveSearchEvaluationPreset} from '../domain/shogi/searchEvaluationPresets';
const saved=parse(readFileSync('docs/benchmarks/outcome-proof-20261022/run1/plan.json','utf8')).positions.find((p:any)=>p.id==='evasion');
const s=saved.state;
const legal=getLegalActions(s);
const chosen=legal.find(a=>a.to.row===8&&a.to.col===3)!;
const alternative=legal.find(a=>a.to.row===7&&a.to.col===3)!;
const small=()=>constructed('boundary-small',[[8,8,'king','sente'],[0,8,'king','gote'],[5,4,'rook','sente'],[4,4,'pawn','gote']]);
const withoutTime=(r:ReturnType<typeof analyzeAlphaBetaSearch>)=>({...r,elapsedMilliseconds:0});
describe('evasion boundary diagnostic contract',()=>{
 it('converts evaluation signs to the original root for both sides',()=>{
  expect(rootScore(123,'gote','sente')).toBe(-123); expect(rootScore(-123,'sente','gote')).toBe(123);
  expect(rootScore(123,'gote','gote')).toBe(123);
 });
 it('distinguishes full-window exact and window bounds, including equality',()=>{
  const v=(n:number)=>({category:'non-terminal' as const,evaluation:n});
  expect(bound(v(0),v(0),v(10))).toBe('upper');expect(bound(v(10),v(0),v(10))).toBe('lower');
  expect(bound(v(5),v(0),v(10))).toBe('exact');
 });
 it('keeps the candidate ply in the requested depth and uses original perspective',()=>{
  const r=diagnose(s,1,0,chosen);expect(r.result!.principalVariation).toEqual([chosen]);
  expect(r.pv!.rows.map(x=>x.plyFromOriginalRoot)).toEqual([0,1]);
  expect(r.result!.selectedEvaluation).toBe(evaluateSearchPositionBreakdown(apply(s,chosen),s.turn).total);
  expect(r.rootCandidates[0].bound).toBe('exact');
 });
 it('preserves complete nonempty history and rejects mismatched history tails',()=>{
  const start=small(), next=apply(start,getLegalActions(start)[0]), before=hash(next);
  const r=diagnose(next,1,0);expect(hash(next)).toBe(before);
  expect(r.pv!.rows[0].historyLength).toBe(next.history.length);
  expect(r.pv!.rows[1].historyLength).toBe(next.history.length+1);
  const broken=structuredClone(next);broken.positionHistory!.at(-1)!.key='invalid';
  expect(()=>diagnose(broken,1,0)).toThrow(/history tail/);
 });
 it('rejects illegal fixed candidates and never returns a completed score',()=>{
  const r=diagnose(s,1,0,{...chosen,to:{row:0,col:0}});expect(r.error).toMatch(/legal/);
  expect(r.completedDepth).toBe(0);expect(r.valueKind).toBe(null);
 });
 it('checks legal replay and rejects a forged move in persisted results',()=>{
  const r=diagnose(s,1,0,chosen);const tampered=structuredClone(r);
  tampered.result!.principalVariation[0]={...chosen,to:{row:0,col:0}};
  expect(()=>aggregate(s,[tampered])).toThrow();
  expect(()=>replay(s,[{...chosen,to:{row:0,col:0}}],1,0)).toThrow();
 });
 it('does not turn a bound equal to the selected score into an exact tie',()=>{
  const r=diagnose(s,1,0);const score=r.result!.selectedEvaluation!;
  r.rootCandidates.push({action:alternative,value:{category:'non-terminal',evaluation:score},bound:'upper'});
  expect(aggregate(s,[r])[0].ties).not.toContainEqual(alternative);
 });
 it('marks node and time interruptions incomplete even after an evaluated candidate',()=>{
  const r=diagnose(s,1,0,null,{...limits,nodes:3});
  expect(r.rootCandidates.length).toBeGreaterThan(0);expect(r.result).toBe(null);expect(r.completedDepth).toBe(0);expect(r.limitReason).toBe('nodes');
  const timed=diagnose(s,1,0,null,limits,{now:(()=>{let n=0;return()=>n++*10000;})()});
  expect(timed.timedOut).toBe(true);expect(timed.valueKind).toBe(null);
 });
 it('records explicit interruption and exceptions separately',()=>{
  expect(diagnose(s,1,0,null,limits,{interrupted:()=>true}).limitReason).toBe('interrupted');
  const r=diagnose(s,1,0,null,limits,{interrupted:()=>{throw Error('probe failure');}});
  expect(r.limitReason).toBe('exception');expect(r.error).toMatch(/probe failure/);
 });
 it('caps trace storage without changing the search result',()=>{
  const r=diagnose(s,2,0,null,{...limits,traceEvents:1,traceBytes:128});
  expect(r.traceBytes).toBeLessThanOrEqual(128);expect(r.traceOmitted).toBeGreaterThan(0);
  expect(r.traceLimitReached).toBe(true);expect(r.completedDepth).toBe(2);
  expect(withoutTime(r.result!)).toEqual(withoutTime(diagnose(s,2,0).result!));
 });
 it('retains cutoff and horizon reasons and remaining budgets',()=>{
  const r=diagnose(s,2,0);expect(r.stops['to-quiescence']).toBeGreaterThan(0);
  expect(r.stops['alpha-beta']).toBeGreaterThan(0);
  expect(r.trace.some((e:any)=>e.phase==='quiescence'&&e.remainingCheckEvasions===0)).toBe(true);
 });
 it('reaggregates saved JSON and detects altered evaluation/trace replay',()=>{
  const r=diagnose(s,1,0);expect(aggregate(s,[parse(json(r))])).toEqual(aggregate(s,[r]));
  const broken=structuredClone(r);broken.pv!.rows[1].breakdown={...broken.pv!.rows[1].breakdown,total:broken.pv!.rows[1].breakdown.total+1};
  expect(()=>aggregate(s,[broken])).toThrow();
 });
 it.each([0,1,2])('trace enabled/disabled leaves every non-time result identical extra %i',extra=>{
  const plain=analyzeAlphaBetaSearch(s,2,resolveSearchEvaluationPreset('standard'),undefined,settings(extra));
  expect(withoutTime(diagnose(s,2,extra).result!)).toEqual(withoutTime(plain));
  const d=new SearchDiagnostics();d.traceNode=()=>{};
  expect(withoutTime(analyzeAlphaBetaSearch(s,2,resolveSearchEvaluationPreset('standard'),undefined,settings(extra),d))).toEqual(withoutTime(plain));
 });
 it.each([false,true])('agrees with existing independent full width in both colors, reverse=%s',reverse=>{
  for(const state of [small(),rotate(small(),'boundary-small-gote')]) {
   const ref=evasionReference(state,1,1,0,state.turn,0,reverse),r=diagnose(state,1,0);
   expect(r.result!.selectedEvaluation).toBe(ref.breakdown.total);
   const selected=evasionReference(apply(state,r.result!.selectedAction!),0,1,0,state.turn,1,reverse);
   expect(compareReference(selected,ref)).toBe(0); // tied PVs need not match
  }
 });
 it('independent full-window scores identify ties in original legal order',()=>{
  const values=legal.map(a=>({action:a,score:diagnose(s,1,0,a).result!.selectedEvaluation!}));
  const best=Math.max(...values.map(v=>v.score)),ties=values.filter(v=>v.score===best);
  expect(ties.length).toBeGreaterThan(1);
  expect(diagnose(s,1,0).result!.selectedAction).toEqual(ties[0].action);
 });
 it('reproduces a quiet promotion boundary without using a copied engine output as oracle',()=>{
  const after=apply(s,chosen);
  const promotion=getLegalActions(after).find(a=>a.kind==='move'&&a.pieceType==='rook'&&a.to.row===8&&a.to.col===4&&a.promotion==='promote')!;
  expect(promotion).toBeDefined();expect(after.squares[promotion.to.row][promotion.to.col].piece).toBe(null);
  const stopped=evaluateSearchPositionBreakdown(after,s.turn),read=evaluateSearchPositionBreakdown(apply(after,promotion),s.turn);
  expect(read.material-stopped.material).toBe(-200); // material table promotion increment, independently evaluated states
  expect(diagnose(s,1,0,chosen).result!.principalVariation).toEqual([chosen]);
  const deeper=diagnose(s,2,0,chosen), reply=deeper.result!.principalVariation[1];
  expect(reply.pieceType).toBe('rook');expect(reply.promotion).toBe('promote');
  expect(after.squares[reply.to.row][reply.to.col].piece).toBe(null);
  expect(evaluateSearchPositionBreakdown(apply(after,reply),s.turn).material-stopped.material).toBe(-200);
  expect(deeper.result!.selectedEvaluation).toBeLessThan(stopped.total);
 });
});
