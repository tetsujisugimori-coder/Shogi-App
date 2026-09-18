import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../types/shogi';
import type { LegalAction } from '../domain/shogi/legalActions';
import * as material from '../domain/shogi/materialEvaluation';
import { getLegalActions } from '../domain/shogi/legalActions';
import * as legal from '../domain/shogi/legalActions';
import { DEFAULT_MATERIAL_VALUE_TABLE, type MaterialValueTable } from '../domain/shogi/materialEvaluation';
import * as see from '../domain/shogi/staticExchangeEvaluation';
import { SEARCH_EVALUATION_PRESET_IDS, resolveSearchEvaluationPreset } from '../domain/shogi/searchEvaluationPresets';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import {
  analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  orderAlphaBetaNodeActions, orderIterativeDeepeningRootActions,
} from '../domain/shogi/twoPlyAlphaBetaAi';

const SEE_OPTIONS = Object.freeze({ moveOrdering: 'static-exchange' } as const);

function position(turn: Player = 'sente'): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  const placements: [number, number, PieceType, Player][] = [
    [8, 8, 'king', 'sente'], [0, 8, 'king', 'gote'],
    [1, 2, 'pawn', 'sente'], [0, 2, 'silver', 'gote'],
    [4, 4, 'rook', 'sente'], [4, 5, 'rook', 'gote'], [2, 0, 'pawn', 'sente'],
  ];
  for (const [row, col, type, player] of placements) {
    const r = turn === 'sente' ? row : 8 - row;
    const c = turn === 'sente' ? col : 8 - col;
    state.squares[r][c].piece = {
      id: `${row}-${col}`, type, player: turn === 'sente' ? player : player === 'sente' ? 'gote' : 'sente',
    };
  }
  state.turn = turn;
  state.senteHand = turn === 'sente' ? [{ id: 'hand', type: 'gold', player: turn }] : [];
  state.goteHand = turn === 'gote' ? [{ id: 'hand', type: 'gold', player: turn }] : [];
  return state;
}

function categories(state: BoardState) {
  const all = getLegalActions(state);
  const captures = all.filter((a) => a.kind === 'move' && state.squares[a.to.row][a.to.col].piece);
  const promotion = all.find((a) => a.kind === 'move' && a.promotion === 'promote' && !captures.includes(a));
  const normal = all.find((a) => a.kind === 'move' && a.promotion === 'none' && !captures.includes(a));
  const drop = all.find((a) => a.kind === 'drop');
  const promotedCapture = captures.find((a) => a.promotion === 'promote');
  const ordinaryCapture = captures.find((a) => a.promotion === 'none');
  if (!promotion || !normal || !drop || !promotedCapture || !ordinaryCapture) throw new Error('Incomplete fixture');
  return { all, captures, promotion, normal, drop, promotedCapture, ordinaryCapture };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

// Observe each candidate without replacing the shared preparation with public
// single-action calls. Contract/deadline tests can replace only this evaluator.
function observePreparedSee() {
  const originalPrepare = see.prepareStaticExchangeEvaluation;
  const evaluate = vi.fn((
    _state: BoardState, action: LegalAction, _table: MaterialValueTable,
    prepared: (action: LegalAction) => number | null
  ) => prepared(action));
  const preparation = vi.spyOn(see, 'prepareStaticExchangeEvaluation')
    .mockImplementation((state, table = DEFAULT_MATERIAL_VALUE_TABLE) => {
      const prepared = originalPrepare(state, table);
      return (action) => evaluate(state, action, table, prepared);
    });
  return Object.assign(evaluate, { preparation });
}

afterEach(() => vi.restoreAllMocks());

describe('SEE capture ordering', () => {
  it.each([0, 1])('skips SEE for %i captures while preserving classification and frozen inputs', (captureCount) => {
    const state = position();
    // Keep only the forced promoting capture (or remove both targets).
    state.squares[4][5].piece = null;
    if (captureCount === 0) state.squares[0][2].piece = null;
    const actions = getLegalActions(state);
    const captures = actions.filter((a) => a.kind === 'move' && state.squares[a.to.row][a.to.col].piece);
    const promotions = actions.filter((a) => a.promotion === 'promote' && !captures.includes(a));
    const others = actions.filter((a) => !captures.includes(a) && !promotions.includes(a));
    expect(captures).toHaveLength(captureCount);
    expect(promotions.length).toBeGreaterThan(0);
    expect(others.some((a) => a.kind === 'drop')).toBe(true);
    const table = structuredClone(DEFAULT_MATERIAL_VALUE_TABLE);
    const snapshot = structuredClone({ state, actions, table });
    freezeDeep(state); freezeDeep(actions); freezeDeep(table);
    const spy = observePreparedSee().mockImplementation(() => {
      throw new Error('SEE must not run without a competing capture');
    });
    const ordered = orderAlphaBetaNodeActions(state, actions, table, undefined, SEE_OPTIONS);
    expect(ordered).not.toBe(actions);
    expect(ordered).toEqual([...captures, ...promotions, ...others]);
    expect(orderAlphaBetaNodeActions(state, actions, table, undefined, SEE_OPTIONS)).toEqual(ordered);
    expect({ state, actions, table }).toEqual(snapshot);
    expect(spy).not.toHaveBeenCalled();
    expect(spy.preparation).not.toHaveBeenCalled();
  });

  it.each(['sente', 'gote'] as const)('%s uses descending moving-side SEE even across promotion classes', (turn) => {
    const state = position(turn);
    const { ordinaryCapture, promotedCapture } = categories(state);
    expect(see.evaluateStaticExchange(state, ordinaryCapture)).toBeGreaterThan(
      see.evaluateStaticExchange(state, promotedCapture) ?? Infinity
    );
    for (const source of [[promotedCapture, ordinaryCapture], [ordinaryCapture, promotedCapture]]) {
      expect(orderAlphaBetaNodeActions(state, source, undefined, undefined, SEE_OPTIONS)).toEqual([ordinaryCapture, promotedCapture]);
    }
  });

  it('preserves supplied indexes for equal capture scores', () => {
    const state = position();
    const { captures } = categories(state);
    observePreparedSee().mockReturnValue(200);
    expect(orderAlphaBetaNodeActions(state, captures, undefined, undefined, SEE_OPTIONS)).toEqual(captures);
    expect(orderAlphaBetaNodeActions(state, [...captures].reverse(), undefined, undefined, SEE_OPTIONS)).toEqual([...captures].reverse());
  });

  it('retains real negative exchanges ahead of quiet promotions, moves and drops', () => {
    const state = position();
    state.squares[4][5].piece = { id: 'bait', type: 'pawn', player: 'gote' };
    state.squares[4][6].piece = { id: 'defender', type: 'rook', player: 'gote' };
    const { ordinaryCapture, promotedCapture, normal, drop, promotion } = categories(state);
    expect(see.evaluateStaticExchange(state, ordinaryCapture)).toBeLessThan(0);
    expect(orderAlphaBetaNodeActions(state, [normal, drop, promotion, ordinaryCapture, promotedCapture], undefined, undefined, SEE_OPTIONS))
      .toEqual([promotedCapture, ordinaryCapture, promotion, normal, drop]);
  });

  it('calls SEE once per capture and never for quiet moves, promotions or drops', () => {
    const state = position();
    const { all, captures } = categories(state);
    expect(captures.length).toBeGreaterThanOrEqual(2);
    const spy = observePreparedSee();
    const generated = vi.spyOn(legal, 'getLegalActions');
    const baseline = vi.spyOn(material, 'evaluateMaterial');
    orderAlphaBetaNodeActions(state, all, undefined, undefined, SEE_OPTIONS);
    expect(spy).toHaveBeenCalledTimes(captures.length);
    expect(spy.preparation).toHaveBeenCalledTimes(1);
    expect(generated.mock.calls.filter(([input]) => input === state)).toHaveLength(1);
    expect(baseline.mock.calls.filter(([input]) => input === state)).toHaveLength(1);
    expect(generated.mock.calls.some(([input]) => input !== state)).toBe(true);
    for (const capture of captures) {
      expect(spy.mock.calls.filter(([, action]) => action === capture)).toHaveLength(1);
    }
  });

  it.each(['direct', 'options'] as const)('uses custom material values through %s config', (form) => {
    const state = position();
    const { promotedCapture, ordinaryCapture } = categories(state);
    const table: MaterialValueTable = {
      unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, silver: 2000 },
      promoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.promoted },
    };
    const config = form === 'direct' ? table : { materialValueTable: table };
    expect(orderAlphaBetaNodeActions(state, [ordinaryCapture, promotedCapture], config, undefined, SEE_OPTIONS))
      .toEqual([promotedCapture, ordinaryCapture]);
    const spy = observePreparedSee();
    analyzeAlphaBetaSearch(state, 2, config, undefined, SEE_OPTIONS);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.every(([, , received]) => received === table)).toBe(true);
  });

  it('defaults omitted material in options and preserves frozen inputs deterministically', () => {
    const state = freezeDeep(position());
    const actions = freezeDeep(getLegalActions(state));
    const table = freezeDeep(structuredClone(DEFAULT_MATERIAL_VALUE_TABLE));
    const before = structuredClone({ state, actions, table });
    const first = orderAlphaBetaNodeActions(state, actions, table, undefined, SEE_OPTIONS);
    expect(first).not.toBe(actions);
    expect(first.every((action) => actions.includes(action))).toBe(true);
    expect(orderAlphaBetaNodeActions(state, actions, table, undefined, SEE_OPTIONS)).toEqual(first);
    expect(orderAlphaBetaNodeActions(state, actions, {}, undefined, SEE_OPTIONS)).toEqual(first);
    expect({ state, actions, table }).toEqual(before);
  });

  it('throws on null instead of substituting a zero score', () => {
    const state = position();
    expect(categories(state).captures.length).toBeGreaterThanOrEqual(2);
    observePreparedSee().mockReturnValue(null);
    expect(() => orderAlphaBetaNodeActions(state, getLegalActions(state), undefined, undefined, SEE_OPTIONS)).toThrow(/contract violated/);
  });

  it('propagates SEE errors including non-finite material failures unchanged', () => {
    const state = position();
    expect(categories(state).captures.length).toBeGreaterThanOrEqual(2);
    const error = new RangeError('finite material difference');
    observePreparedSee().mockImplementation(() => { throw error; });
    expect(() => orderAlphaBetaNodeActions(state, getLegalActions(state), undefined, undefined, SEE_OPTIONS)).toThrow(error);
    expect(() => analyzeAlphaBetaSearch(state, 2, undefined, undefined, SEE_OPTIONS)).toThrow(error);
  });

  it('preserves public SEE non-finite validation when multiple captures need comparison', () => {
    const state = position();
    const { captures } = categories(state);
    expect(captures.length).toBeGreaterThanOrEqual(2);
    const table = {
      ...DEFAULT_MATERIAL_VALUE_TABLE,
      unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, rook: Infinity },
    };
    expect(() => orderAlphaBetaNodeActions(state, captures, table, undefined, SEE_OPTIONS)).toThrow(RangeError);
  });

  it.each([0, 1])('skips SEE for %i remaining root captures after moving the previous best first', (remaining) => {
    const state = position();
    const { normal, drop, promotion, ordinaryCapture, promotedCapture } = categories(state);
    const rest = remaining === 1 ? [ordinaryCapture] : [];
    const actions = [normal, ...rest, drop, promotion, promotedCapture];
    const spy = observePreparedSee();
    expect(orderIterativeDeepeningRootActions(state, actions, promotedCapture, undefined, undefined, SEE_OPTIONS))
      .toEqual([promotedCapture, ...rest, promotion, normal, drop]);
    expect(spy).not.toHaveBeenCalled();
    expect(spy.preparation).not.toHaveBeenCalled();
  });

  it('keeps the pre-fix depth-three answer, PV, breakdown and statistics when single captures are skipped', () => {
    const state = createInitialBoardState();
    for (const row of state.squares) for (const square of row) square.piece = null;
    state.squares[8][8].piece = { id: 's-king', type: 'king', player: 'sente' };
    state.squares[0][8].piece = { id: 'g-king', type: 'king', player: 'gote' };
    state.squares[4][4].piece = { id: 's-rook', type: 'rook', player: 'sente' };
    state.squares[4][5].piece = { id: 'g-pawn', type: 'pawn', player: 'gote' };
    const spy = observePreparedSee();
    const result = analyzeAlphaBetaSearch(state, 3, undefined, () => 0, SEE_OPTIONS);
    // Recorded from unmodified PR HEAD 2507fdb, which calls SEE seven times.
    expect(result).toMatchObject({
      selectedAction: { from: { row: 4, col: 4 }, to: { row: 4, col: 5 }, promotion: 'none' },
      selectedEvaluation: 1313, visitedPositionCount: 617, cutoffCount: 18, skippedActionCount: 222,
      evaluationBreakdown: { total: 1313, material: 1300, pieceSquare: 1, kingSafety: 12,
        undefendedPieceSafety: 0, terminal: null },
    });
    expect(result.principalVariation).toMatchObject([
      { from: { row: 4, col: 4 }, to: { row: 4, col: 5 }, promotion: 'none' },
      { from: { row: 0, col: 8 }, to: { row: 0, col: 7 }, promotion: 'none' },
      { from: { row: 4, col: 5 }, to: { row: 0, col: 5 }, promotion: 'promote' },
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(analyzeAlphaBetaSearch(state, 3, undefined, () => 0, SEE_OPTIONS)).toEqual(result);
  });

  it('keeps the previous best first and applies custom SEE only to remaining root captures', () => {
    const state = position();
    const { all, normal, captures } = categories(state);
    const table = { ...DEFAULT_MATERIAL_VALUE_TABLE, unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, silver: 2000 } };
    const spy = observePreparedSee();
    const ordered = orderIterativeDeepeningRootActions(state, all, normal, { materialValueTable: table }, undefined, SEE_OPTIONS);
    expect(ordered[0]).toBe(normal);
    expect(spy).toHaveBeenCalledTimes(captures.length);
    expect(spy.mock.calls.every(([, , received]) => received === table)).toBe(true);
    expect(ordered.slice(1)).toEqual(orderAlphaBetaNodeActions(state, all.filter((a) => a !== normal), table, undefined, SEE_OPTIONS));
  });

  it('preserves fixed root order without evaluating captures when no previous best exists', () => {
    const state = position();
    const actions = getLegalActions(state);
    const spy = observePreparedSee();
    expect(orderIterativeDeepeningRootActions(state, actions, null, undefined, undefined, SEE_OPTIONS)).toEqual(actions);
    analyzeAlphaBetaSearch(state, 1, undefined, undefined, SEE_OPTIONS);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['before', 'after'] as const)('checks interruption %s a capture evaluation', (when) => {
    const state = position();
    const spy = observePreparedSee();
    const error = new Error('interrupted');
    let checks = 0;
    expect(() => orderAlphaBetaNodeActions(state, getLegalActions(state), undefined, () => {
      checks++;
      if (checks === (when === 'before' ? 1 : 2)) throw error;
    }, SEE_OPTIONS)).toThrow(error);
    expect(spy).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
    expect(spy.preparation).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
  });

  it('checks interruption before and after every capture, including subsequent shared evaluations', () => {
    const state = position();
    const { captures } = categories(state);
    const events: string[] = [];
    observePreparedSee().mockImplementation((_state, action, _table, evaluate) => {
      events.push('evaluate');
      return evaluate(action);
    });
    orderAlphaBetaNodeActions(state, captures, undefined, () => { events.push('check'); }, SEE_OPTIONS);
    expect(events).toEqual(captures.flatMap(() => ['check', 'evaluate', 'check']));
  });

  it.each(['sente', 'gote'] as const)('matches individual public SEE search results and statistics for %s with custom values', (turn) => {
    const state = freezeDeep(position(turn));
    const table = freezeDeep({
      unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, silver: 1700 },
      promoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.promoted, silver: 2200 },
    });
    const before = structuredClone({ state, table });
    const prepared = analyzeAlphaBetaSearch(state, 2, table, () => 0, SEE_OPTIONS);
    expect(analyzeAlphaBetaSearch(state, 2, table, () => 0, SEE_OPTIONS)).toEqual(prepared);
    const spy = vi.spyOn(see, 'prepareStaticExchangeEvaluation').mockImplementation((input, values) =>
      (action) => see.evaluateStaticExchange(input, action, values));
    expect(analyzeAlphaBetaSearch(state, 2, table, () => 0, SEE_OPTIONS)).toEqual(prepared);
    expect(spy).toHaveBeenCalled();
    expect({ state, table }).toEqual(before);
  });

  it('discards an iteration whose SEE evaluation crosses the deadline', () => {
    const state = position();
    const fallback = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 1, 10, undefined, () => 0, SEE_OPTIONS);
    let now = 0;
    const spy = observePreparedSee().mockImplementation((_state, action, _table, evaluate) => {
      const score = evaluate(action);
      now = 10;
      return score;
    });
    const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 3, 10, undefined, () => now, SEE_OPTIONS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ...fallback, requestedMaxDepth: 3, timedOut: true, elapsedMilliseconds: 10 });
  });

  it('counts explored successor positions without counting SEE internal executions', () => {
    const state = position();
    const originalExecute = legal.executeLegalAction;
    let inSee = false;
    let searchExecutions = 0;
    let seeExecutions = 0;
    observePreparedSee().mockImplementation((_state, action, _table, evaluate) => {
      inSee = true;
      try { return evaluate(action); } finally { inSee = false; }
    });
    vi.spyOn(legal, 'executeLegalAction').mockImplementation((...args) => {
      if (inSee) seeExecutions++;
      else searchExecutions++;
      return originalExecute(...args);
    });
    const result = analyzeAlphaBetaSearch(state, 2, undefined, undefined, SEE_OPTIONS);
    expect(seeExecutions).toBeGreaterThan(0);
    expect(result.visitedPositionCount).toBe(searchExecutions);
    expect(result.cutoffCount).toBeGreaterThan(0);
    expect(result.skippedActionCount).toBeGreaterThanOrEqual(result.cutoffCount);
  });

  it.each(SEARCH_EVALUATION_PRESET_IDS)('Worker handler with explicitly injected SEE search matches direct search for %s', (presetId) => {
    const state = position();
    const spy = observePreparedSee();
    const response = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest({
      type: 'run-time-limited-iterative-deepening-alpha-beta-search',
      requestId: 'see-captures', state: structuredClone(state), maxDepth: 2,
      timeLimitMilliseconds: 1000, evaluationPresetId: presetId,
    }, (input, depth, limit, evaluation) =>
      analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input, depth, limit, evaluation, () => 0, SEE_OPTIONS));
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(response).toEqual({
      type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded', requestId: 'see-captures',
      result: {
        ...analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 1000, resolveSearchEvaluationPreset(presetId), () => 0, SEE_OPTIONS),
        evaluationPresetId: presetId,
      },
    });
    expect(structuredClone(response)).toEqual(response);
  });
});
