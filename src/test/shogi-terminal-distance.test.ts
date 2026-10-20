import { DEFAULT_MATERIAL_VALUE_TABLE as TABLE } from '../domain/shogi/materialEvaluation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { distancePositions, apply, observePv, exhaustive, compareReference } from '../../scripts/benchmarks/terminalDistanceReference';
import { constructed, rotate } from '../../scripts/benchmarks/tacticalPositions';
import { analyzeAlphaBetaSearch, analyzeIterativeDeepeningAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../domain/shogi/twoPlyAlphaBetaAi';
import { analyzeQuiescenceSearchWithInternalBounds as q, analyzeQuiescenceSearch } from '../domain/shogi/quiescenceSearch';
import { searchValue, compareSearchValues as compare, SEARCH_BOTTOM, SEARCH_TOP } from '../domain/shogi/searchValue';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import * as legal from '../domain/shogi/legalActions';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest as worker } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';

afterEach(() => vi.restoreAllMocks());
const position = (id: string) => distancePositions().find(p=>p.id===id)!.state;

describe('root-relative terminal distance', () => {
  it('orders outcomes above arbitrary numeric evaluations and keeps draw numeric', () => {
    const b = evaluateSearchPositionBreakdown(position('mixed-distance'), 'sente');
    const win = searchValue({...b,total:Infinity,terminal:'win'},3);
    const loss = searchValue({...b,total:-Infinity,terminal:'loss'},3);
    for (const evaluation of [-Number.MAX_VALUE,0,Number.MAX_VALUE,Infinity,-Infinity]) {
      const numeric = searchValue({...b,total:evaluation,terminal:null},0);
      expect(compare(win,numeric)).toBeGreaterThan(0);
      expect(compare(loss,numeric)).toBeLessThan(0);
    }
    expect(searchValue({...b,total:0,terminal:'draw'},99)).toEqual({category:'non-terminal',evaluation:0});
    expect(compare(SEARCH_TOP,win)).toBeGreaterThan(0);
    expect(compare(SEARCH_BOTTOM,loss)).toBeLessThan(0);
  });

  it.each([false,true])('selects one-ply over three-ply wins with reversed legal order=%s', reverse => {
    const state = position('mixed-distance');
    const original = legal.getLegalActions;
    if (reverse) vi.spyOn(legal,'getLegalActions').mockImplementation((...args)=>original(...args).reverse());
    for (const s of [state,rotate(state,'win-rotated')]) {
      const result = analyzeAlphaBetaSearch(s,3);
      expect(result.selectedEvaluation).toBe(Infinity);
      expect(observePv(s,result.principalVariation).terminalDistancePly).toBe(1);
      expect(result.evaluationBreakdown.total).toBe(result.selectedEvaluation);
    }
  });

  it.each(['terminal-resistance','terminal-resistance-gote'])('resists for four plies instead of two: %s', id => {
    const s = position(id), before = structuredClone(s);
    const actions = legal.getLegalActions(s);
    // Exhaustive reference has no product comparator, pruning, or move ordering.
    const candidates = actions.map(a=>exhaustive(apply(s,a),3,null,s.turn,1));
    expect(candidates.map(c=>c.breakdown.terminal)).toEqual(['loss','loss']);
    expect(candidates.map(c=>c.terminalDistancePly)).toEqual(id==='terminal-resistance'?[2,4]:[4,2]);
    for (const options of [undefined,{quiescence:{maxTacticalDepth:1}}]) {
      const r = analyzeAlphaBetaSearch(s,4,undefined,undefined,options);
      expect(r.selectedEvaluation).toBe(-Infinity);
      expect(observePv(s,r.principalVariation).terminalDistancePly).toBe(4);
      expect(r.evaluationBreakdown).toEqual(observePv(s,r.principalVariation).breakdown);
    }
    expect(s).toEqual(before);
  });

  it('keeps iterative and reordered root ties consistent with fixed search', () => {
    const s = position('mixed-distance');
    const fixed = analyzeAlphaBetaSearch(s,4), iterative = analyzeIterativeDeepeningAlphaBetaSearch(s,4);
    expect(iterative.selectedAction).toEqual(fixed.selectedAction);
    expect(iterative.principalVariation).toEqual(fixed.principalVariation);
    expect(iterative.iterations.every(i=>observePv(s,i.principalVariation).terminalDistancePly===1)).toBe(true);
  });

  it('distinguishes immediate no_legal_actions from checkmate without changing public Infinity', () => {
    const s = position('mixed-distance');
    const a = legal.getLegalActions(s).find(a=>a.kind==='move'&&a.pieceType==='king'&&a.to.row===1&&a.to.col===2)!;
    const leaf = apply(s,a);
    expect(leaf.result?.endReason).toBe('no_legal_actions');
    const r = q(leaf,s.turn,0,TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,1);
    expect(r.searchValue).toEqual({category:'win',terminalDistancePly:1});
    expect(r.selectedEvaluation).toBe(Infinity);
    expect(leaf.result?.endReason).toBe('no_legal_actions');
  });

  it.each(['checkmate','no_legal_actions','resignation','foul_loss','agreed_jishogi_point_loss',
    'entering_king_win','entering_king_declaration_failure'] as const)('all decisive reasons retain distance and perspective: %s', endReason => {
    const s = position('mixed-distance');
    // Use recorded decisive states to exercise category handling independent of adjudication.
    const terminal = {...s,status:'ended' as const,result:{winner:'sente',loser:'gote',endReason}} as typeof s;
    for (const perspective of ['sente','gote'] as const) {
      const r = q(terminal,perspective,0,TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,7);
      expect(r.searchValue).toEqual({category:perspective==='sente'?'win':'loss',terminalDistancePly:7});
    }
  });

  it.each(['repetition','five_hundred_move_jishogi','agreed_jishogi_draw','entering_king_draw'] as const)(
    'draw %s has no terminal distance', endReason => {
      const s = position('mixed-distance');
      const terminal = {...s,status:'ended' as const,result:{winner:null,loser:null,endReason,
        sentePoints:0,gotePoints:0}} as typeof s;
      const r = q(terminal,s.turn,2,TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,7);
      expect(r.searchValue).toEqual({category:'non-terminal',evaluation:0});
      expect(r.evaluationBreakdown.terminal).toBe('draw');
    });

  it('advances root-relative distance through a real tactical terminal capture', () => {
    const s = position('mate-sente');
    const r = q(s,s.turn,1,TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,3);
    expect(r.searchValue).toEqual({category:'win',terminalDistancePly:4});
    expect(r.principalVariation).toHaveLength(1);
    expect(observePv(s,r.principalVariation).reason).toBe('checkmate');
  });

  it('carries ordinary ply into tactical recursion and respects the zero-depth approximation', () => {
    const s = position('mate-sente');
    // A checked defending child forces the q evasion path; compare to exhaustive q.
    const a = legal.getLegalActions(s).find(a=>apply(s,a).status==='check')!;
    const child = apply(s,a);
    const r = q(child,s.turn,2,TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,1);
    const ref = exhaustive(child,0,2,s.turn,1);
    expect(compareReference(observePv(child,r.principalVariation,s.turn),{...ref,terminalDistancePly:ref.terminalDistancePly===null?null:ref.terminalDistancePly-1})).toBe(0);
    if (r.searchValue.category==='win'||r.searchValue.category==='loss')
      expect(r.searchValue.terminalDistancePly).toBe(1+r.principalVariation.length);
    const zero = analyzeQuiescenceSearch(child,s.turn,0);
    expect(zero.evaluationBreakdown.terminal).toBeNull();
    expect(zero.principalVariation).toEqual([]);
  });

  it('keeps terminal-distance fail-low and fail-high values bounded without calling them exact', () => {
    const s = position('mate-sente');
    const action = legal.getLegalActions(s).find(a=>apply(s,a).status==='check')!;
    const child = apply(s,action);
    const exact = q(child,s.turn,2,TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,1);
    for (const [alpha,beta] of [[exact.searchValue,SEARCH_TOP],[SEARCH_BOTTOM,exact.searchValue]]) {
      const r = q(child,s.turn,2,TABLE,undefined,alpha,beta,'original',undefined,1);
      // Fail-soft upper/lower results obey their window relation, even for equal infinities.
      if (alpha===exact.searchValue) expect(compare(r.searchValue,alpha)).toBeLessThanOrEqual(0);
      else expect(compare(r.searchValue,beta)).toBeGreaterThanOrEqual(0);
    }
  });

  it.each([100,1000])('retains timed, fallback and real worker public contracts at %ims', milliseconds => {
    const s = position('terminal-resistance');
    const r = timed(s,4,milliseconds,undefined,()=>0);
    expect(r.resultSource).toBe('completed-iteration');
    expect(r.completedDepth).toBe(4);
    expect(observePv(s,r.principalVariation).terminalDistancePly).toBe(4);
    const fallback = timed(s,4,milliseconds,undefined,()=>milliseconds);
    // A constant clock has zero elapsed; use a clock that expires after initialization.
    let reads=0;
    const expired = timed(s,4,milliseconds,undefined,()=>reads++===0?0:milliseconds);
    expect(expired).toMatchObject({resultSource:'fallback',selectedEvaluation:null,evaluationBreakdown:null,principalVariation:[],completedDepth:0});
    expect(fallback.selectedEvaluation).toBe(-Infinity);
    const response = worker({type:'run-time-limited-iterative-deepening-alpha-beta-search',requestId:'distance',
      state:s,maxDepth:4,timeLimitMilliseconds:milliseconds}, (s,d,t,e,c,o)=>timed(s,d,t,e,()=>0,o));
    expect(response.type).toBe('time-limited-iterative-deepening-alpha-beta-search-succeeded');
    if (response.type==='time-limited-iterative-deepening-alpha-beta-search-succeeded') {
      expect(structuredClone(response).result.selectedEvaluation).toBe(-Infinity);
      expect(observePv(s,response.result.principalVariation).terminalDistancePly).toBe(4);
      expect(Object.keys(response.result)).not.toContain('searchValue');
    }
  });
});
