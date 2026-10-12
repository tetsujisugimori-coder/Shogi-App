import { afterEach, describe, expect, it, vi } from 'vitest';
import * as legal from '../domain/shogi/legalActions';
import * as see from '../domain/shogi/staticExchangeEvaluation';
import * as material from '../domain/shogi/materialEvaluation';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, orderAlphaBetaNodeActions } from '../domain/shogi/twoPlyAlphaBetaAi';
import { createSeeDeadlinePosition } from '../../scripts/benchmarks/seeDeadlinePosition';
import type { BoardState } from '../types/shogi';
import baseline from './fixtures/see-deadline-baseline.json';

const options = { moveOrdering: 'static-exchange' } as const;
const prepare = see.prepareStaticExchangeEvaluation;
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function fixture() {
  const state = freeze(createSeeDeadlinePosition());
  const action = legal.getLegalActions(state).find(a => a.kind === 'move' &&
    a.from.row === 5 && a.from.col === 4 && a.to.row === 4 && a.to.col === 4)!;
  expect(action).toBeDefined();
  return { state, action, table: freeze(structuredClone(material.DEFAULT_MATERIAL_VALUE_TABLE)) };
}
afterEach(() => vi.restoreAllMocks());

describe('cooperative SEE deadline', () => {
  it('interrupts inside a recapture recursion before the next generation, not outside the evaluator', () => {
    const { state, action, table } = fixture();
    const before = JSON.stringify({ state, action, table });
    const generated = vi.spyOn(legal, 'getLegalActions');
    const executed = vi.spyOn(legal, 'executeLegalAction');
    const signal = new Error('recapture deadline');
    let internalChecks = 0;
    const evaluate = prepare(state, table, () => {
      if (executed.mock.calls.length >= 2) { internalChecks++; throw signal; }
    });
    expect(() => evaluate(action)).toThrow(signal);
    expect(internalChecks).toBe(1);
    expect(executed).toHaveBeenCalledTimes(2); // initial capture + first recapture
    expect(generated).toHaveBeenCalledTimes(2); // preparation + first continuation
    expect(JSON.stringify({ state, action, table })).toBe(before);
  });

  it.each(['prepare-entry', 'prepare-generated', 'evaluation-entry', 'baseline', 'initial-applied',
    'recaptures-generated', 'before-recapture', 'recapture-applied', 'continuation-generated'] as const)
  ('propagates at %s and does no subsequent candidate work', (boundary) => {
    const { state, action, table } = fixture();
    const before = JSON.stringify({ state, action, table });
    const originalGenerate = legal.getLegalActions;
    const originalExecute = legal.executeLegalAction;
    const originalMaterial = material.evaluateMaterial;
    let ready = boundary === 'prepare-entry';
    let evaluating = false;
    let generations = 0, executions = 0, materialCalls = 0;
    let countsAtInterruption: number[] | undefined;
    vi.spyOn(legal, 'getLegalActions').mockImplementation((...args) => {
      const result = originalGenerate(...args); generations++;
      if (boundary === 'prepare-generated' && generations === 1 ||
          boundary === 'recaptures-generated' && generations === 2 ||
          boundary === 'continuation-generated' && generations === 3) ready = true;
      return result;
    });
    vi.spyOn(legal, 'executeLegalAction').mockImplementation((...args) => {
      const result = originalExecute(...args); executions++;
      if (boundary === 'initial-applied' && executions === 1 ||
          boundary === 'recapture-applied' && executions === 2) ready = true;
      return result;
    });
    vi.spyOn(material, 'evaluateMaterial').mockImplementation((...args) => {
      const result = originalMaterial(...args); materialCalls++;
      if (boundary === 'baseline' && materialCalls === 1) ready = true;
      return result;
    });
    const signal = new Error(boundary);
    const check = () => {
      if (boundary === 'evaluation-entry' && evaluating) ready = true;
      // Skip the post-generation check, then interrupt before applying a recapture.
      if (boundary === 'before-recapture' && generations === 2) {
        if (ready) { countsAtInterruption = [generations, executions, materialCalls]; throw signal; }
        ready = true;
        return;
      }
      if (ready) { countsAtInterruption = [generations, executions, materialCalls]; throw signal; }
    };
    expect(() => {
      const evaluate = prepare(state, table, check);
      evaluating = true;
      evaluate(action);
    }).toThrow(signal);
    expect(countsAtInterruption).toBeDefined();
    expect([generations, executions, materialCalls]).toEqual(countsAtInterruption);
    if (boundary === 'prepare-entry') expect(generations).toBe(0);
    if (boundary === 'recaptures-generated' || boundary === 'before-recapture') expect(executions).toBe(1);
    if (boundary === 'recapture-applied') expect(executions).toBe(2);
    expect(JSON.stringify({ state, action, table })).toBe(before);
  });

  it.each(['final-result', 'recursion-return'] as const)('checks %s before accepting a completed score', boundary => {
    const { state, action, table } = fixture();
    const originalGenerate = legal.getLegalActions;
    const executed = vi.spyOn(legal, 'executeLegalAction');
    let leafReached = false, leafChecks = 0, executionsAtLeaf = 0;
    vi.spyOn(legal, 'getLegalActions').mockImplementation((...args) => {
      const actions = originalGenerate(...args);
      const occupant = args[0].squares[4][4].piece;
      if (executed.mock.calls.length >= 2 && actions.length > 0 &&
          !actions.some(a => a.kind === 'move' && a.to.row === 4 && a.to.col === 4 && occupant?.player !== a.player)) {
        leafReached = true; executionsAtLeaf = executed.mock.calls.length;
      }
      return actions;
    });
    const signal = new Error(boundary);
    const evaluate = prepare(state, table, () => {
      if (leafReached && ++leafChecks === (boundary === 'final-result' ? 2 : 3)) throw signal;
    });
    // At the leaf: post-generation check, final-result check, then parent return check.
    expect(() => evaluate(action)).toThrow(signal);
    expect(leafReached).toBe(true);
    expect(executed.mock.calls.length).toBe(executionsAtLeaf);
  });

  it('depth one has no SEE path and retains the existing uncompleted fallback contract', () => {
    const { state } = fixture();
    const before = JSON.stringify(state);
    const fallback = legal.getLegalActions(state)[0];
    const preparation = vi.spyOn(see, 'prepareStaticExchangeEvaluation');
    const actualExecute = legal.executeLegalAction;
    let now = 0;
    vi.spyOn(legal, 'executeLegalAction').mockImplementation((...args) => {
      const result = actualExecute(...args); now = 100; return result;
    });
    const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 1, 100, undefined, () => now, options);
    expect(result).toMatchObject({ selectedAction: fallback, selectedEvaluation: null, evaluationBreakdown: null,
      principalVariation: [], completedDepth: 0, depth: 0, timedOut: true, resultSource: 'fallback',
      iterations: [], totalVisitedPositionCount: 0, totalQuiescenceVisitedPositionCount: 0 });
    expect(preparation).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });

  it('depth two SEE recursion throws the actual injected deadline and retains only depth one', () => {
    const { state } = fixture();
    const before = JSON.stringify(state);
    const completed = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 1, 100, undefined, () => 0, options);
    const actualPrepare = see.prepareStaticExchangeEvaluation;
    const actualExecute = legal.executeLegalAction;
    let inSee = false, now = 0, seeExecutions = 0, interruptedInternally = false;
    vi.spyOn(see, 'prepareStaticExchangeEvaluation').mockImplementation((...args) => {
      // Cast preserves compatibility while running the new test against the old source.
      const [input, table, check] = args as [BoardState, material.MaterialValueTable | undefined, (() => void) | undefined];
      const evaluate = (actualPrepare as typeof prepare)(input, table, () => {
        try { check?.(); } catch (error) { interruptedInternally = inSee; throw error; }
      });
      return action => { inSee = true; try { return evaluate(action); } finally { inSee = false; } };
    });
    vi.spyOn(legal, 'executeLegalAction').mockImplementation((...args) => {
      const result = actualExecute(...args);
      if (inSee && ++seeExecutions === 2) now = 100;
      return result;
    });
    const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 3, 100, undefined, () => now, options);
    expect(interruptedInternally).toBe(true);
    expect(seeExecutions).toBe(2);
    expect(result).toEqual({ ...completed, requestedMaxDepth: 3, timedOut: true, elapsedMilliseconds: 100 });
    expect(result.iterations).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('nonexpiring checks preserve public values, stable capture order and full fixed/timed results', () => {
    const { state, action, table } = fixture();
    const before = JSON.stringify({ state, action, table });
    let checks = 0;
    expect(prepare(state, table, () => { checks++; })(action)).toBe(see.evaluateStaticExchange(state, action, table));
    expect(checks).toBeGreaterThan(10);
    const actions = freeze(legal.getLegalActions(state));
    const captures = actions.filter(a => a.kind === 'move' && state.squares[a.to.row][a.to.col].piece);
    expect(captures.length).toBeGreaterThanOrEqual(2);
    expect(orderAlphaBetaNodeActions(state, actions, table, () => {}, options))
      .toEqual(orderAlphaBetaNodeActions(state, actions, table, undefined, options));
    const fixed = analyzeAlphaBetaSearch(state, 2, table, () => 0, options);
    const timed = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 1000, table, () => 0, options);
    expect(fixed).toEqual(baseline['static-exchange'].fixed);
    expect(timed).toEqual(baseline['static-exchange'].timed);
    expect(orderAlphaBetaNodeActions(state, actions, table, () => {}, options)).toEqual(baseline['static-exchange'].ordered);
    for (const { action: capture, value } of baseline.captures) {
      expect(see.evaluateStaticExchange(state, capture as legal.LegalAction, table)).toBe(value);
    }
    expect(timed).toMatchObject({ completedDepth: 2, timedOut: false, selectedAction: fixed.selectedAction,
      selectedEvaluation: fixed.selectedEvaluation, principalVariation: fixed.principalVariation });
    expect(JSON.stringify({ state, action, table })).toBe(before);
  });

  it('standard retains all baseline results and starts no SEE', () => {
    const { state } = fixture();
    const preparation = vi.spyOn(see, 'prepareStaticExchangeEvaluation');
    for (const setting of [undefined, { moveOrdering: 'standard' } as const]) {
      expect(analyzeAlphaBetaSearch(state, 2, undefined, () => 0, setting)).toEqual(baseline.standard.fixed);
      expect(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 1000, undefined, () => 0, setting))
        .toEqual(baseline.standard.timed);
    }
    expect(preparation).not.toHaveBeenCalled();
  });

  it('normal SEE errors propagate through timed search unchanged and never become timeouts', () => {
    const { state } = fixture();
    const before = JSON.stringify(state);
    const error = new RangeError('ordinary SEE calculation failure');
    const actualPrepare = see.prepareStaticExchangeEvaluation;
    vi.spyOn(see, 'prepareStaticExchangeEvaluation').mockImplementation((...args) => {
      const evaluate = actualPrepare(...args);
      return action => {
        vi.spyOn(material, 'evaluateMaterial').mockImplementation(() => { throw error; });
        return evaluate(action);
      };
    });
    expect(() => analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 100, undefined, () => 0, options)).toThrow(error);
    expect(JSON.stringify(state)).toBe(before);
  });
});
