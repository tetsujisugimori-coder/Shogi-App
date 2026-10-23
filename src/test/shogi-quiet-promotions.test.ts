import { describe, expect, it, vi } from 'vitest';
import { analyzeQuiescenceSearch, analyzeQuiescenceSearchWithInternalBounds } from '../domain/shogi/quiescenceSearch';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import { executeLegalAction, getLegalActions, type LegalAction } from '../domain/shogi/legalActions';
import { isPlayerInCheck } from '../domain/shogi/checkmate';
import { SEARCH_BOTTOM, SEARCH_TOP } from '../domain/shogi/searchValue';
import { constructed, rotate, tacticalPositions } from '../../scripts/benchmarks/tacticalPositions';
import { evasionReference } from '../../scripts/benchmarks/checkEvasionReference';
import { exchangePositions } from '../../scripts/benchmarks/exchangePositions';
import { SearchDiagnostics } from '../domain/shogi/searchDiagnostics';
import * as see from '../domain/shogi/staticExchangeEvaluation';
import * as quiescence from '../domain/shogi/quiescenceSearch';
import { DEFAULT_MATERIAL_VALUE_TABLE, evaluateMaterial } from '../domain/shogi/materialEvaluation';
import type { BoardState } from '../types/shogi';

function replay(s: BoardState, pv: readonly LegalAction[]) {
  for (const a of pv) {
    expect(getLegalActions(s)).toContainEqual(a);
    const next = executeLegalAction(s,a);
    if (next.type !== 'applied') throw new Error('Illegal PV');
    s = next.state;
  }
  return s;
}
const opts = { quiescence:{maxTacticalDepth:1, includeQuietPromotions:true} } as const;
const evasion = () => tacticalPositions().find(p => p.id === 'evasion')!.state;
const q = (s: BoardState, d: number, enabled = true, check?: () => void) =>
  analyzeQuiescenceSearch(s, s.turn, d, undefined, check, 'original', 0, undefined, enabled);

describe('bounded quiet promotions in existing quiescence', () => {
  it.each(['sente','gote'] as const)('%s reproduces the PR #208 omitted rook promotion and removes its shallow ranking gap', side => {
    const s = side === 'sente' ? evasion() : rotate(evasion(),'rotated');
    const before = analyzeAlphaBetaSearch(s,1,undefined,undefined,{quiescence:{maxTacticalDepth:1}});
    const after = analyzeAlphaBetaSearch(s,1,undefined,undefined,opts);
    const deeper = analyzeAlphaBetaSearch(s,3,undefined,undefined,{quiescence:{maxTacticalDepth:1}});
    expect(before.selectedAction).not.toEqual(deeper.selectedAction);
    expect(after.selectedAction).toEqual(deeper.selectedAction);
    // Check the former preferred candidate independently, without root alpha/beta bounds.
    const child = replay(s,[before.selectedAction!]);
    const oldQ = q(child,1,false), newQ = q(child,1);
    expect(oldQ.visitedPositionCount).toBe(0);
    expect(newQ.principalVariation[0]?.promotion).toBe('promote');
    expect(newQ.evaluationBreakdown.material - oldQ.evaluationBreakdown.material).toBe(200);
    expect(after.evaluationBreakdown).toEqual(evaluateSearchPositionBreakdown(replay(s,after.principalVariation),s.turn));
  });

  it.each([false,true])('matches full width/reverse reference including checks and terminal distance (reverse=%s)', reverse => {
    for (const p of exchangePositions().filter(p => ['evasion-promotion','evasion-promotion-gote','promotion-capture','exchange-chain'].includes(p.id))) {
      const result = analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts);
      const reference = evasionReference(p.state,1,1,0,p.state.turn,0,reverse,true);
      expect(result.selectedEvaluation,p.id).toBe(reference.breakdown.total);
      expect(result.evaluationBreakdown.terminal,p.id).toBe(reference.breakdown.terminal);
    }
  });

  it('same budget; material ordering preserves value and zero depth still stops', () => {
    const s = replay(evasion(),[getLegalActions(evasion()).find(a => a.to.row === 8 && a.to.col === 3)!]);
    expect(q(s,0).visitedPositionCount).toBe(0);
    const result = q(s,1);
    expect(result.principalVariation).toHaveLength(1);
    expect(analyzeQuiescenceSearch(s,s.turn,1,undefined,undefined,'material',0,undefined,true).selectedEvaluation).toBe(result.selectedEvaluation);
    expect(evaluateSearchPositionBreakdown(replay(s,result.principalVariation),s.turn)).toEqual(result.evaluationBreakdown);
  });

  it('does not blindly add promotion gain: an exposed promoted pawn is recaptured at q2', () => {
    const s = constructed('unsafe-promotion',[[8,8,'king','sente'],[0,8,'king','gote'],[3,4,'pawn','sente'],[1,4,'gold','gote']]);
    expect(q(s,1).principalVariation[0]?.promotion).toBe('promote');
    expect(q(s,2).principalVariation).toEqual([]);
    expect(q(s,2).selectedEvaluation).toBe(evaluateSearchPositionBreakdown(s,s.turn).total);
    expect(q(s,2).visitedPositionCount).toBeGreaterThan(q(s,1).visitedPositionCount);
  });

  it('keeps all checked evasions including hand drops; SEE is never a q pruning criterion', () => {
    const s = exchangePositions().find(p => p.id === 'gold-drop-evasion')!.state;
    let enteredChildren = 0;
    const diagnostics = new SearchDiagnostics();
    diagnostics.traceNode = e => { if (e.kind === 'enter' && e.ply === 1) enteredChildren++; };
    const spy = vi.spyOn(see,'prepareStaticExchangeEvaluation').mockImplementation(() => {throw new Error('SEE must not run');});
    try {
      const result = analyzeQuiescenceSearchWithInternalBounds(s,s.turn,1,DEFAULT_MATERIAL_VALUE_TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',diagnostics,0,0,undefined,true);
      expect(result.visitedPositionCount).toBe(getLegalActions(s).length);
      expect(enteredChildren).toBe(getLegalActions(s).length);
      expect(getLegalActions(s).some(a => a.kind === 'drop')).toBe(true);
      expect(isPlayerInCheck(replay(s,result.principalVariation),s.turn)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('existing SEE already accounts for three legal captures and unpromoted hand gains', () => {
    const s = exchangePositions().find(p => p.id === 'exchange-chain')!.state;
    let leaf = s;
    const baseline = evaluateMaterial(s,s.turn);
    const deltas: number[] = [];
    let first: LegalAction | undefined;
    for (const [row,col] of [[5,4],[3,4],[5,5]]) {
      const a = getLegalActions(leaf).find(a => a.kind === 'move' && a.from.row === row && a.from.col === col && a.to.row === 4 && a.to.col === 4)!;
      expect(a).toBeDefined(); first ??= a;
      leaf = replay(leaf,[a]); deltas.push(evaluateMaterial(leaf,s.turn)-baseline);
    }
    expect(deltas).toEqual([200,-1800,-1000]);
    expect(leaf.senteHand.map(p => p.type)).toEqual(['pawn','silver']);
    expect(leaf.goteHand.map(p => p.type)).toEqual(['rook']);
    expect(see.evaluateStaticExchange(s,first!)).toBe(-1000);
  });

  it('propagates interruption inside a newly included promotion without a partial score', () => {
    const s = replay(evasion(),[getLegalActions(evasion()).find(a => a.to.row === 8 && a.to.col === 3)!]);
    const stop = new Error('deadline'); let calls = 0;
    expect(() => q(s,1,true,() => { if (++calls === 3) throw stop; })).toThrow(stop);
    expect(calls).toBe(3);
  });

  it('preserves timed completed-iteration, partial-root and fallback contracts', () => {
    const s = evasion();
    for (const limit of [0,20,10000]) {
      let tick = 0;
      const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,2,limit,undefined,() => tick++,opts);
      if (result.resultSource === 'fallback') {
        expect(result.completedDepth).toBe(0); expect(result.selectedEvaluation).toBeNull(); expect(result.principalVariation).toEqual([]);
      } else {
        expect(result.principalVariation[0]).toEqual(result.selectedAction);
        expect(result.evaluationBreakdown).toEqual(evaluateSearchPositionBreakdown(replay(s,result.principalVariation),s.turn));
        expect(result.completedDepth).toBe(result.iterations.at(-1)?.depth ?? 0);
      }
    }
  });

  it('retains exact root candidates and then a completed iteration when deeper promotion work stops', () => {
    const s = evasion(); let calls = 0;
    const real = quiescence.analyzeQuiescenceSearchWithInternalBounds;
    const spy = vi.spyOn(quiescence,'analyzeQuiescenceSearchWithInternalBounds').mockImplementation((...args) => {calls++;return real(...args);});
    try {
      const first = analyzeAlphaBetaSearch(s,1,undefined,undefined,opts), firstCalls = calls;
      calls = 0;
      const partial = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,4,100,undefined,() => calls >= 2 ? 100 : 0,opts);
      expect(partial).toMatchObject({resultSource:'partial-root',completedDepth:0,timedOut:true});
      expect(partial.partialRoot!.exactRootCandidateCount).toBeGreaterThan(0);
      expect(partial.evaluationBreakdown).toEqual(evaluateSearchPositionBreakdown(replay(s,partial.principalVariation),s.turn));
      calls = 0;
      const completed = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,4,100,undefined,() => calls > firstCalls ? 100 : 0,opts);
      expect(completed).toMatchObject({resultSource:'completed-iteration',completedDepth:1,timedOut:true});
      expect(completed.selectedAction).toEqual(first.selectedAction);
      expect(completed.principalVariation).toEqual(first.principalVariation);
    } finally { spy.mockRestore(); }
  });

  it('a legal quiet promotion can mate, using the existing terminal score and ply distance', () => {
    const s = constructed('promotion-mate',[[0,0,'king','gote'],[2,1,'king','sente'],[1,1,'pawn','sente'],[1,2,'gold','sente']]);
    const result = analyzeQuiescenceSearchWithInternalBounds(s,s.turn,1,DEFAULT_MATERIAL_VALUE_TABLE,undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,4,0,undefined,true);
    expect(result.principalVariation).toHaveLength(1);
    expect(result.principalVariation[0].promotion).toBe('promote');
    const leaf = replay(s,result.principalVariation);
    expect(leaf.status).toBe('ended');
    expect(leaf.result?.endReason).toBe('checkmate');
    expect(result.evaluationBreakdown.terminal).toBe('win');
    expect(result.searchValue).toMatchObject({terminalDistancePly:5});
  });

  it('TT and previous PV hints retain the new candidate semantics and inputs', () => {
    const s = evasion(), saved = structuredClone(s);
    const plain = analyzeAlphaBetaSearch(s,2,undefined,undefined,opts);
    const tt = analyzeAlphaBetaSearch(s,2,undefined,undefined,{...opts,useTranspositionTable:true});
    expect(tt.selectedAction).toEqual(plain.selectedAction);
    expect(tt.selectedEvaluation).toBe(plain.selectedEvaluation);
    const timed = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,2,1000,undefined,() => 0,{...opts,usePreviousIterationPv:true});
    expect(timed.selectedAction).toEqual(plain.selectedAction);
    expect(timed.selectedEvaluation).toBe(plain.selectedEvaluation);
    expect(s).toEqual(saved);
  });

  it.each([null,0,1,'true',{},[]].map(value => [value]))('rejects invalid option %j', value => {
    expect(() => analyzeAlphaBetaSearch(evasion(),1,undefined,undefined,{quiescence:{maxTacticalDepth:1,includeQuietPromotions:value as never}})).toThrow(/boolean/);
    expect(() => analyzeQuiescenceSearch(evasion(),'sente',1,undefined,undefined,'original',0,undefined,value as never)).toThrow(/boolean/);
  });
});
