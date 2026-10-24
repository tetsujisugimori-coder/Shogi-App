import { describe, it, expect, vi } from 'vitest';
import fixture from './fixtures/selective-review-before.json';
import type {BoardState,Player} from '../types/shogi';
import {analyzeQuiescenceSearchWithinBounds,analyzeQuiescenceSearch} from '../domain/shogi/quiescenceSearch';
import {analyzeAlphaBetaSearch,analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch} from '../domain/shogi/twoPlyAlphaBetaAi';
import {resolveQuietPromotionSelection,validateQuietPromotionSelection,rankQuietPromotions} from '../domain/shogi/quietPromotionSelection';
import {getLegalActions} from '../domain/shogi/legalActions';
import {DEFAULT_MATERIAL_VALUE_TABLE as table} from '../domain/shogi/materialEvaluation';
import {SearchDiagnostics} from '../domain/shogi/searchDiagnostics';
import {ExactTranspositionTable} from '../domain/shogi/transpositionTable';
import * as attacks from '../domain/shogi/attacks';
const revive=(v:unknown)=>JSON.parse(JSON.stringify(v),(_k,v)=>v==='Infinity'?Infinity:v==='-Infinity'?-Infinity:v);
const cases=revive(fixture).cases as {name:string;state:BoardState;perspective:Player;window:{alpha:number;beta:number};result:unknown;calls:number;diagnostics:unknown}[];
const state=cases.find(c=>c.name==='safe/sente/max/full')!.state;
const options=(selector:unknown)=>({quiescence:{maxTacticalDepth:1,selectiveQuietPromotions:selector as {maxCandidates:number}}});
const strip=({elapsedMilliseconds:_ms,...r}:ReturnType<typeof analyzeAlphaBetaSearch>)=>r;
describe('P212 P2-1: preserve stand-pat candidate/statistics dependency',()=>{
 it.each(cases)('$name equals reviewed HEAD including PV, counts and interruption schedule',c=>{
  const saved=JSON.stringify(c.state),d=new SearchDiagnostics();let calls=0;
  const result=analyzeQuiescenceSearchWithinBounds(c.state,c.perspective,1,undefined!,()=>calls++,c.window.alpha,c.window.beta,'original',d,0,undefined,false,{maxCandidates:1});
  expect(result).toEqual(c.result);expect(calls).toBe(c.calls);
  expect({...d.quietPromotions,selectionCalls:d.phases['q-select-promotions'].calls}).toEqual(c.diagnostics);
  expect(JSON.stringify(c.state)).toBe(saved);
 });
 it('does not scan for the king when there are no quiet promotions, while preserving cooperative checks',()=>{
  const s=cases.find(c=>c.name==='zero/sente/max/full')!.state;
  const spy=vi.spyOn(attacks,'findKingSquare');let calls=0;
  try {expect(rankQuietPromotions(s,getLegalActions(s),table,()=>calls++)).toEqual([]);expect(spy).not.toHaveBeenCalled();expect(calls).toBe(getLegalActions(s).length+1);}finally{spy.mockRestore();}
 });
 it('finds the enemy king once for multiple candidates',()=>{
  const s=cases.find(c=>c.name==='multiple/sente/max/full')!.state,actions=getLegalActions(s);
  const spy=vi.spyOn(attacks,'findKingSquare');try{expect(rankQuietPromotions(s,actions,table)).toHaveLength(2);expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
 });
 it.each([1,2,5,10])('propagates interruption at unchanged callback %s in a closed window',at=>{
  const s=cases.find(c=>c.name==='multiple/sente/max/closed')!.state,saved=JSON.stringify(s);let calls=0;const stop=Error('cooperative stop');
  expect(()=>analyzeQuiescenceSearchWithinBounds(s,s.turn,1,table,()=>{if(++calls===at)throw stop;},0,0,'original',undefined,0,undefined,false,{maxCandidates:1})).toThrow(stop);
  expect(calls).toBe(at);expect(JSON.stringify(s)).toBe(saved);
 });
 it('zero candidates do not become a stand-pat cutoff; positive candidates count their real skipped set',()=>{
  const zero=cases.find(c=>c.name==='zero/sente/max/equal')!,multi=cases.find(c=>c.name==='multiple/sente/max/equal')!;
  expect(zero.result).toMatchObject({cutoffCount:0,skippedActionCount:0});
  expect(multi.result).toMatchObject({cutoffCount:1,skippedActionCount:1});
 });
});
describe('P212 P2-2: validated selector is a plain value snapshot',()=>{
 const valid=[{name:'plain',create:()=>({maxCandidates:1})},{name:'non-enumerable',create:()=>Object.defineProperty({},'maxCandidates',{value:1})},{name:'null prototype',create:()=>Object.assign(Object.create(null),{maxCandidates:1})}];
 it.each(valid)('$name works in fixed/timed/q and TT identity',({create})=>{
  const selector=create();expect(resolveQuietPromotionSelection(selector)).toEqual({maxCandidates:1});expect(()=>validateQuietPromotionSelection(selector)).not.toThrow();
  const expected=analyzeAlphaBetaSearch(state,2,undefined,undefined,options({maxCandidates:1}));
  const spy=vi.spyOn(ExactTranspositionTable.prototype,'store');
  try {
   const r=analyzeAlphaBetaSearch(state,2,undefined,undefined,{...options(selector),useTranspositionTable:true});expect(strip(r)).toEqual(strip(expected));
   expect(spy.mock.calls.length).toBeGreaterThan(0);for(const call of spy.mock.calls)expect(JSON.parse(call[1])[2].selectiveQuietPromotions).toEqual({maxCandidates:1});
  } finally{spy.mockRestore();}
  const t=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,2,1000,undefined,()=>0,{...options(selector),usePreviousIterationPv:true});expect(t.selectedAction).toEqual(expected.selectedAction);expect(t.selectedEvaluation).toBe(expected.selectedEvaluation);
  expect(analyzeQuiescenceSearch(state,state.turn,1,undefined,undefined,'original',0,undefined,false,selector)).toEqual(analyzeQuiescenceSearch(state,state.turn,1,undefined,undefined,'original',0,undefined,false,{maxCandidates:1}));
 });
 it('reads the accepted maxCandidates getter once before copying in each public API',()=>{
  let reads=0;const selector=Object.defineProperty({},'maxCandidates',{get:()=>{reads++;return reads===1?1:undefined;}});
  analyzeAlphaBetaSearch(state,1,undefined,undefined,options(selector));expect(reads).toBe(1);
  reads=0;analyzeQuiescenceSearch(state,state.turn,1,undefined,undefined,'original',0,undefined,false,selector as never);expect(reads).toBe(1);
 });
 const invalid=[null,[],{},true,{maxCandidates:undefined},...[0,-1,1.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1].map(maxCandidates=>({maxCandidates})),{maxCandidates:1,extra:1},Object.defineProperty({maxCandidates:1},'extra',{value:1}),Object.assign({maxCandidates:1},{[Symbol('extra')]:1}),Object.create({maxCandidates:1})];
 it.each(invalid.map((value,i)=>({value,i})))('rejects invalid/inherited-only selector $i before copying',({value})=>{
  expect(()=>resolveQuietPromotionSelection(value)).toThrow(/maxCandidates/);expect(()=>validateQuietPromotionSelection(value)).toThrow(/maxCandidates/);
  expect(()=>analyzeAlphaBetaSearch(state,1,undefined,undefined,options(value))).toThrow(/maxCandidates/);
  expect(()=>analyzeQuiescenceSearch(state,state.turn,0,undefined,undefined,'original',0,undefined,false,value as never)).toThrow(/maxCandidates/);
 });
 it('undefined omits selection; A, B and C retain their mutual exclusion',()=>{
  expect(resolveQuietPromotionSelection(undefined)).toBeUndefined();
  for(const includeQuietPromotions of [false,true]) {
   const base={quiescence:{maxTacticalDepth:1,includeQuietPromotions}};
   expect(strip(analyzeAlphaBetaSearch(state,1,undefined,undefined,{quiescence:{...base.quiescence,selectiveQuietPromotions:undefined}}))).toEqual(strip(analyzeAlphaBetaSearch(state,1,undefined,undefined,base)));
  }
  expect(()=>analyzeAlphaBetaSearch(state,1,undefined,undefined,{quiescence:{maxTacticalDepth:1,includeQuietPromotions:true,selectiveQuietPromotions:{maxCandidates:1}}})).toThrow(/both/);
  expect(()=>analyzeAlphaBetaSearch(state,1,undefined,undefined,options({maxCandidates:1}))).not.toThrow();
 });
});
