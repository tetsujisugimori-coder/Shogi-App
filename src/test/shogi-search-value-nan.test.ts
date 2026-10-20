import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareSearchValues as compare, numericalSearchBound, searchValue, SEARCH_BOTTOM, SEARCH_TOP, type SearchValue } from '../domain/shogi/searchValue';
import { createInitialBoardState } from '../types/shogi';
import { DEFAULT_MATERIAL_VALUE_TABLE as TABLE } from '../domain/shogi/materialEvaluation';
import * as evaluation from '../domain/shogi/twoPlyMinimaxAi';
import { analyzeAlphaBetaSearch as alpha, analyzeIterativeDeepeningAlphaBetaSearch as iterative,
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../domain/shogi/twoPlyAlphaBetaAi';
import { analyzeQuiescenceSearch as q, analyzeQuiescenceSearchWithinBounds as boundedQ } from '../domain/shogi/quiescenceSearch';
import { tacticalPositions } from '../../scripts/benchmarks/tacticalPositions';
import * as legal from '../domain/shogi/legalActions';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest as worker } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';

const breakdown = (total: number, terminal: evaluation.SearchEvaluationBreakdown['terminal'] = null): evaluation.SearchEvaluationBreakdown =>
  ({ total, terminal, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0 });
const values: SearchValue[] = [SEARCH_BOTTOM, searchValue(breakdown(-Infinity,'loss'),2),
  searchValue(breakdown(-Infinity,'loss'),4), ...[-Infinity,-3,0,3,Infinity].map(n=>searchValue(breakdown(n),0)),
  searchValue(breakdown(Infinity,'win'),3), searchValue(breakdown(Infinity,'win'),1), SEARCH_TOP];
afterEach(()=>vi.restoreAllMocks());

describe('search value NaN rejection and valid ordering', () => {
  it('keeps finite, equal, infinite, distance and sentinel order antisymmetric', () => {
    for (const [i,a] of values.entries()) for (const [j,b] of values.entries()) {
      expect(Math.sign(compare(a,b))).toBe(Math.sign(i-j));
      expect(Math.sign(compare(a,b))+Math.sign(compare(b,a))).toBe(0);
    }
    expect(searchValue(breakdown(0,'draw'),99)).toEqual({category:'non-terminal',evaluation:0});
    expect(compare(searchValue(breakdown(0,'draw'),99),searchValue(breakdown(0),0))).toBe(0);
    expect(numericalSearchBound(-Infinity)).toBe(SEARCH_BOTTOM);
    expect(numericalSearchBound(Infinity)).toBe(SEARCH_TOP);
    expect(numericalSearchBound(3)).toEqual({category:'non-terminal',evaluation:3});
  });
  it.each([null,'draw'] as const)('rejects NaN non-decisive evaluation (%s)', terminal => {
    expect(()=>searchValue(breakdown(NaN,terminal),0)).toThrow(/NaN/);
  });
  it('rejects a NaN numerical window bound even before q evaluation', () => {
    expect(()=>numericalSearchBound(NaN)).toThrow(/NaN/);
    for (const [a,b] of [[NaN,Infinity],[-Infinity,NaN]])
      expect(()=>boundedQ(createInitialBoardState(),'sente',0,TABLE,undefined,a,b)).toThrow(/NaN/);
  });
  it('rejects directly constructed NaN values on either side before category ranking', () => {
    for (const bad of [{category:'non-terminal',evaluation:NaN},
      {category:'win',terminalDistancePly:NaN},{category:'loss',terminalDistancePly:NaN}] as SearchValue[]) {
      for (const good of [...values,bad]) {
        expect(()=>compare(bad,good)).toThrow(/NaN/);
        expect(()=>compare(good,bad)).toThrow(/NaN/);
      }
    }
  });
  it.each(['win','loss'] as const)('rejects a directly supplied NaN %s distance', terminal => {
    expect(()=>searchValue(breakdown(terminal==='win'?Infinity:-Infinity,terminal),NaN)).toThrow(/NaN/);
  });
});

const settings = [
  {name:'direct NaN table', state:createInitialBoardState(), config:{...TABLE,unpromoted:{...TABLE.unpromoted,pawn:NaN}}},
  {name:'finite table overflow (Infinity minus Infinity)',state:createInitialBoardState(),
    config:{...TABLE,unpromoted:{...TABLE.unpromoted,pawn:Number.MAX_VALUE}}},
  {name:'finite coefficient overflow (opposite infinite terms)',state:tacticalPositions().find(p=>p.id==='recapture')!.state,
    config:{coefficients:{material:Number.MAX_VALUE,pieceSquare:Number.MAX_VALUE,kingSafety:Number.MAX_VALUE,undefendedPieceSafety:Number.MAX_VALUE}}},
];

describe('anomalous evaluation propagates as an error, never a deadline result', () => {
  it('demonstrates both finite overflow paths without changing evaluation formulas', () => {
    const material = evaluation.evaluateSearchPositionBreakdown(settings[1].state,'sente',settings[1].config);
    expect(material.total).toBeNaN();
    const coefficients = evaluation.evaluateSearchPositionBreakdown(settings[2].state,'sente',settings[2].config);
    expect(coefficients.material).toBe(Infinity);
    expect(coefficients.pieceSquare).toBe(-Infinity);
    expect(coefficients.total).toBeNaN();
  });
  for (const setting of settings) {
    const {state,config}=setting;
    it.each(['alpha-beta','alpha-zero','quiescence','minimax','iterative','timed'] as const)(`${setting.name}: %s throws`, mode => {
      const before=structuredClone(state);
      const run=()=> mode==='alpha-beta'?alpha(state,1,config,()=>0)
        : mode==='alpha-zero'?alpha(state,0,config,()=>0)
        : mode==='quiescence'?q(state,state.turn,0,config)
        : mode==='minimax'?evaluation.analyzeTwoPlyMinimaxSearch(state,config,()=>0)
        : mode==='iterative'?iterative(state,1,config,()=>0)
        : timed(state,1,100,config,()=>0);
      expect(run).toThrow(/NaN/);
      expect(state).toEqual(before);
    });
  }
  it('propagates NaN after a valid candidate instead of returning saved partial-root', () => {
    const actual=evaluation.evaluateSearchPositionBreakdown;
    let leaves=0;
    vi.spyOn(evaluation,'evaluateSearchPositionBreakdown').mockImplementation((...args)=>
      ++leaves===1?actual(...args):breakdown(NaN));
    expect(()=>timed(createInitialBoardState(),1,100,TABLE,()=>0)).toThrow(/NaN/);
    expect(leaves).toBe(2);
  });
  it('rejects an anomalous no-action root evaluation in every root return path', () => {
    // The existing API supports king-missing analysis fixtures. A Sente pawn
    // on the final rank has no move, so exercise the real no-action evaluator
    // rather than mocking an export also called within its defining module.
    const s=createInitialBoardState();
    for (const row of s.squares) for (const square of row) square.piece=null;
    s.squares[0][0].piece={id:'immobile-analysis-pawn',type:'pawn',player:'sente'};
    expect(legal.getLegalActions(s)).toEqual([]);
    const config=settings[0].config;
    for (const run of [()=>alpha(s,1,config),()=>evaluation.analyzeTwoPlyMinimaxSearch(s,config),()=>timed(s,1,100,config,()=>0)])
      expect(run).toThrow(/NaN/);
  });
  it('still returns the existing fallback when the deadline prevents any evaluation', () => {
    let reads=0;
    const r=timed(settings[0].state,1,100,settings[0].config,()=>reads++===0?0:100);
    expect(r).toMatchObject({resultSource:'fallback',selectedEvaluation:null,evaluationBreakdown:null,
      principalVariation:[],completedDepth:0,timedOut:true});
  });
  it('uses the existing Worker failure response instead of a successful fallback', () => {
    const response=worker({type:'run-time-limited-iterative-deepening-alpha-beta-search',requestId:'nan',
      state:settings[0].state,maxDepth:1,timeLimitMilliseconds:100},
      (state,depth,time)=>timed(state,depth,time,settings[0].config,()=>0));
    expect(response).toMatchObject({type:'time-limited-iterative-deepening-alpha-beta-search-failed',
      requestId:'nan',errorName:'RangeError',errorMessage:expect.stringContaining('NaN')});
    expect(response).not.toHaveProperty('result');
  });
});
