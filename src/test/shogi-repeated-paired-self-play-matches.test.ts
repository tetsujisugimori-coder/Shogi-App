import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  cloneBoardState, createPositionSnapshot, executeLegalAction, getLegalActions,
  runPairedSelfPlayMatch, runRepeatedPairedSelfPlayMatches,
  type LegalAction, type PairedSelfPlayOutcome, type RepeatedPairedSelfPlayMatchesResult,
  type RepeatedPairedSelfPlayOptions, type SelfPlaySearchResult,
} from '../domain/shogi';
import * as pairedRunner from '../domain/shogi/pairedSelfPlayMatch';
import { createInitialBoardState, type BoardState, type Piece, type Player } from '../types/shogi';

function position(turn: Player = 'sente', pieces: Array<[number, number, Piece]> = []): BoardState {
  const initial = createInitialBoardState();
  const placements: Array<[number, number, Piece]> = [
    [8, 4, { id: 'sk', type: 'king', player: 'sente' }],
    [0, 4, { id: 'gk', type: 'king', player: 'gote' }], ...pieces,
  ];
  const state: BoardState = { ...initial, turn, positionHistory: [], positionSnapshots: [],
    squares: initial.squares.map((row) => row.map((square) => ({ ...square,
      piece: placements.find(([r, c]) => r === square.row && c === square.col)?.[2] ?? null,
    }))),
  };
  state.positionSnapshots = [createPositionSnapshot(state)];
  return state;
}

function observation(state: BoardState, action = getLegalActions(state)[0]): SelfPlaySearchResult {
  return {
    selectedAction: action, selectedEvaluation: null, completedDepth: null,
    elapsedMilliseconds: null, timedOut: null, principalVariation: null, evaluationBreakdown: null,
    visitedPositionCount: null, cutoffCount: null, skippedActionCount: null,
    quiescenceLeafCount: null, quiescenceVisitedPositionCount: null,
    quiescenceCutoffCount: null, quiescenceSkippedActionCount: null,
    totalVisitedPositionCount: null, totalCutoffCount: null, totalSkippedActionCount: null,
    totalQuiescenceLeafCount: null, totalQuiescenceVisitedPositionCount: null,
    totalQuiescenceCutoffCount: null, totalQuiescenceSkippedActionCount: null,
  };
}

function apply(state: BoardState, action: LegalAction): BoardState {
  const execution = executeLegalAction(state, action, { proposer: 'local_ai' });
  if (execution.type !== 'applied') throw new Error('fixture action must apply');
  return execution.state;
}

function run(initialState: BoardState, pairCount: number, maxPlies = 2,
  search: (state: BoardState) => SelfPlaySearchResult = (state) => observation(state)) {
  return runRepeatedPairedSelfPlayMatches({ initialState, pairCount, maxPlies,
    a: { search, settings: null }, b: { search, settings: null } });
}

function expectSummary(result: RepeatedPairedSelfPlayMatchesResult, outcomes: PairedSelfPlayOutcome[]) {
  expect(result.pairs.flatMap((pair) => pair.result.games.map((game) => game.outcome))).toEqual(outcomes);
  expect(result.summary).toEqual({
    aWins: BigInt(outcomes.filter((o) => o === 'a_win').length),
    bWins: BigInt(outcomes.filter((o) => o === 'b_win').length),
    draws: BigInt(outcomes.filter((o) => o === 'draw').length),
    maxPlies: BigInt(outcomes.filter((o) => o === 'max_plies').length),
    failures: BigInt(outcomes.filter((o) => o === 'failed').length),
  });
  expect(Object.values(result.summary).reduce((a, b) => a + b, 0n)).toBe(BigInt(result.pairs.length) * 2n);
}

function objects(value: unknown, found = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !found.has(value)) {
    found.add(value);
    for (const child of Object.values(value)) objects(child, found);
  }
  return found;
}

function expectDisjoint(left: unknown, right: unknown) {
  const other = objects(right);
  for (const ref of objects(left)) expect(other.has(ref)).toBe(false);
}

afterEach(() => vi.restoreAllMocks());

describe('runRepeatedPairedSelfPlayMatches', () => {
  it.each(['sente', 'gote'] as const)('runs three ordered independent pairs with %s to move and distinct settings types', (turn) => {
    const initialState = position(turn);
    const before = structuredClone(initialState);
    const calls: Array<{ id: 'A' | 'B'; state: BoardState; settings: unknown }> = [];
    const a = { settings: Object.freeze({ depth: 1 }), search: vi.fn((state: BoardState, settings: { depth: number }) => {
      calls.push({ id: 'A', state, settings }); return observation(state);
    }) };
    const b = { settings: 'B algorithm', search: vi.fn((state: BoardState, settings: string) => {
      calls.push({ id: 'B', state, settings }); return observation(state);
    }) };
    const options: RepeatedPairedSelfPlayOptions<{ depth: number }, string> = {
      initialState, a, b, maxPlies: 2, pairCount: 3,
    };
    const delegate = vi.spyOn(pairedRunner, 'runPairedSelfPlayMatch');
    const result = runRepeatedPairedSelfPlayMatches(options);
    expectTypeOf(result).toEqualTypeOf<RepeatedPairedSelfPlayMatchesResult>();
    expectTypeOf(result.summary.aWins).toEqualTypeOf<bigint>();
    expectTypeOf(result.pairs[0].result.summary.aWins).toEqualTypeOf<number>();
    expect(result.pairs.map((pair) => pair.pairNumber)).toEqual([1, 2, 3]);
    expect(delegate).toHaveBeenCalledTimes(3);
    for (const [args] of delegate.mock.calls) {
      expect(args.initialState).toBe(initialState);
      expect(args.a).toBe(a); expect(args.b).toBe(b); expect(args.maxPlies).toBe(2);
    }
    expectSummary(result, Array<PairedSelfPlayOutcome>(6).fill('max_plies'));
    expect(calls.map((call) => call.id)).toEqual(
      Array.from({ length: 3 }, () => turn === 'sente' ? ['A', 'B', 'B', 'A'] : ['B', 'A', 'A', 'B']).flat(),
    );
    expect(a.search).toHaveBeenCalledTimes(6); expect(b.search).toHaveBeenCalledTimes(6);
    for (const call of calls) expect(call.settings).toBe(call.id === 'A' ? a.settings : b.settings);
    for (let i = 0; i < calls.length; i += 2) {
      expect(calls[i].state).toEqual(cloneBoardState(before));
      expectDisjoint(calls[i].state, initialState);
      if (i > 0) expectDisjoint(calls[i].state, calls[i - 2].state);
    }
    const expectedPair = runPairedSelfPlayMatch({ initialState, a, b, maxPlies: 2 });
    for (const pair of result.pairs) {
      expect(pair.result).toEqual(expectedPair);
      expect(pair.result.games).toMatchObject([
        { gameNumber: 1, sente: 'A', gote: 'B' }, { gameNumber: 2, sente: 'B', gote: 'A' },
      ]);
      for (const game of pair.result.games) {
        expect(game.result.plies).toHaveLength(2);
        expect(game.result.finalState.moveNumber).toBe(before.moveNumber + 2);
      }
    }
    expect(initialState).toEqual(before);
    expect(a.settings).toEqual({ depth: 1 }); expect(b.settings).toBe('B algorithm');
  });

  it.each(['sente', 'gote'] as const)('aggregates legal %s wins across both seats and every pair', (winner) => {
    const row = (r: number) => winner === 'sente' ? r : 8 - r;
    const initialState = position(winner, [
      [row(2), 3, { id: 'guard', type: 'gold', player: winner }],
      [row(2), 1, { id: 'left', type: 'bishop', player: winner }],
      [row(2), 7, { id: 'right', type: 'bishop', player: winner }],
    ]);
    initialState[winner === 'sente' ? 'senteHand' : 'goteHand'] = [{ id: 'rook', type: 'rook', player: winner }];
    initialState.positionSnapshots = [createPositionSnapshot(initialState)];
    const result = run(initialState, 3, 1, (state) => {
      const action = getLegalActions(state).find((a) => a.kind === 'drop' && a.to.row === row(1) && a.to.col === 4);
      if (!action) throw new Error('fixture mating drop must exist');
      return observation(state, action);
    });
    expectSummary(result, Array.from({ length: 3 }, (): PairedSelfPlayOutcome[] =>
      winner === 'sente' ? ['a_win', 'b_win'] : ['b_win', 'a_win']).flat());
    for (const game of result.pairs.flatMap((pair) => pair.result.games)) {
      expect(game.result).toMatchObject({ status: 'ended', gameResult: { endReason: 'checkmate', winner } });
    }
  });

  it('counts actual 500-move draws separately from the research ply limit', () => {
    const initialState = { ...position(), moveNumber: 499 };
    const truncated = run(initialState, 2, 1);
    expectSummary(truncated, ['max_plies', 'max_plies', 'max_plies', 'max_plies']);
    const ended = run(initialState, 2, 2);
    expectSummary(ended, ['draw', 'draw', 'draw', 'draw']);
    for (const pair of ended.pairs) for (const game of pair.result.games) {
      expect(game.result).toMatchObject({ status: 'ended', gameResult: { endReason: 'five_hundred_move_jishogi', winner: null } });
    }
  });

  it('continues after a middle pair failure and truncation without resetting stateful searches', () => {
    let call = 0;
    const seen: BoardState[] = [];
    const result = run(position(), 3, 1, (state) => {
      seen.push(state);
      if (++call === 3) throw new Error('one observed failure');
      return { ...observation(state), completedDepth: call };
    });
    expectSummary(result, ['max_plies', 'max_plies', 'failed', 'max_plies', 'max_plies', 'max_plies']);
    expect(call).toBe(6);
    expect(result.pairs.map((pair) => pair.pairNumber)).toEqual([1, 2, 3]);
    expect(result.pairs[1].result.games[0].result).toMatchObject({
      failure: { stage: 'search', code: 'search_exception', message: 'one observed failure' },
    });
    expect(result.pairs.flatMap((pair) => pair.result.games.map((g) => g.result.plies[0]?.completedDepth)))
      .toEqual([1, 2, undefined, 4, 5, 6]);
    for (const state of seen) expect(state).toEqual(seen[0]);
  });

  it.each([0, -0])('accepts pairCount=%s without calling a pair or search', (pairCount) => {
    const search = vi.fn((state: BoardState) => observation(state));
    const delegate = vi.spyOn(pairedRunner, 'runPairedSelfPlayMatch');
    const result = run(position(), pairCount, 2, search);
    expect(result.pairs).toEqual([]);
    expectSummary(result, []);
    expect(search).not.toHaveBeenCalled(); expect(delegate).not.toHaveBeenCalled();
  });

  it.each([
    -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    '2', '', null, undefined, true, false, 2n, {}, [], new Number(2), Symbol('2'),
  ])('rejects invalid pairCount %s before delegating or searching', (pairCount) => {
    const search = vi.fn((state: BoardState) => observation(state));
    const delegate = vi.spyOn(pairedRunner, 'runPairedSelfPlayMatch');
    expect(() => run(position(), pairCount as number, 2, search)).toThrow(
      new RangeError('pairCount must be a finite non-negative safe integer.'),
    );
    expect(delegate).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
  });

  it.each([Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1, Number.MAX_SAFE_INTEGER])(
    'accepts safe pairCount %s without a total-games cap and propagates delegate exceptions', (pairCount) => {
      const error = new Error('stop at the first pair without allocating a huge result');
      const delegate = vi.spyOn(pairedRunner, 'runPairedSelfPlayMatch').mockImplementationOnce(() => { throw error; });
      expect(() => run(position(), pairCount)).toThrow(error);
      expect(delegate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([0, -1, 0.5, NaN, Infinity, '2', null, undefined])('preserves the existing maxPlies=%s contract for every game', (maxPlies) => {
    const search = vi.fn((state: BoardState) => observation(state));
    const delegate = vi.spyOn(pairedRunner, 'runPairedSelfPlayMatch');
    // Pass undefined explicitly rather than triggering the test helper default.
    const result = runRepeatedPairedSelfPlayMatches({ initialState: position(), pairCount: 2,
      maxPlies: maxPlies as number, a: { search, settings: null }, b: { search, settings: null } });
    expectSummary(result, Array<PairedSelfPlayOutcome>(4).fill(maxPlies === 0 ? 'max_plies' : 'failed'));
    expect(delegate).toHaveBeenCalledTimes(2);
    for (const [args] of delegate.mock.calls) expect(args.maxPlies).toBe(maxPlies);
    if (maxPlies !== 0) for (const pair of result.pairs) for (const game of pair.result.games) {
      expect(game.result).toMatchObject({ failure: { stage: 'options', code: 'invalid_max_plies' }, plies: [] });
    }
    expect(search).not.toHaveBeenCalled();
  });

  it('does not turn a pre-search BoardState exception into a failed game', () => {
    const error = new Error('invalid position access');
    const initialState = position();
    Object.defineProperty(initialState, 'squares', { get: () => { throw error; }, enumerable: true });
    const search = vi.fn((state: BoardState) => observation(state));
    expect(() => run(initialState, 2, 1, search)).toThrow(error);
    expect(search).not.toHaveBeenCalled();
  });

  it('isolates full results across pairs, games, input and reused search data, and repeats deterministically', () => {
    let initialState = position();
    initialState.senteHand = [{ id: 'sp', type: 'pawn', player: 'sente' }];
    initialState.goteHand = [{ id: 'gp', type: 'pawn', player: 'gote' }];
    initialState.positionSnapshots = [createPositionSnapshot(initialState)];
    initialState = apply(initialState, getLegalActions(initialState)[0]);
    const before = structuredClone(initialState);
    const shared = observation(initialState);
    const settings = Object.freeze({ nested: Object.freeze({ depth: 1 }) });
    const settingsBefore = structuredClone(settings);
    const search = (state: BoardState): SelfPlaySearchResult => {
      Object.assign(shared, observation(state));
      shared.principalVariation = [shared.selectedAction!];
      shared.selectedEvaluation = 3;
      shared.evaluationBreakdown = { total: 3, material: 3, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: null };
      return shared;
    };
    const options = { initialState, pairCount: 3, maxPlies: 2, a: { search, settings }, b: { search, settings } };
    const result = runRepeatedPairedSelfPlayMatches(options);
    expectSummary(result, Array<PairedSelfPlayOutcome>(6).fill('max_plies'));
    expect(runRepeatedPairedSelfPlayMatches(options)).toEqual(result);
    expect(initialState).toEqual(before); expect(settings).toEqual(settingsBefore);
    expectDisjoint(result, initialState); expectDisjoint(result, shared); expectDisjoint(result, settings);
    for (let i = 0; i < result.pairs.length; i++) for (let j = i + 1; j < result.pairs.length; j++) {
      expectDisjoint(result.pairs[i], result.pairs[j]);
    }
    const games = result.pairs.flatMap((pair) => pair.result.games);
    for (let i = 0; i < games.length; i++) {
      for (let j = i + 1; j < games.length; j++) expectDisjoint(games[i], games[j]);
      expectDisjoint(games[i].result.plies[0], games[i].result.plies[1]);
      for (const ply of games[i].result.plies) {
        expect(ply.principalVariation).toEqual([ply.action]);
        expect(ply.evaluationBreakdown?.total).toBe(3);
      }
    }
    const savedOthers = structuredClone(games.slice(1));
    const first = games[0].result;
    first.finalState.senteHand[0].type = 'rook';
    first.finalState.goteHand[0].type = 'rook';
    first.finalState.history[0].to.col = 0;
    first.finalState.positionHistory![0].key = 'changed';
    first.finalState.positionSnapshots![0].squares[0][4].piece!.type = 'pawn';
    first.plies[0].action.to.col = 0;
    first.plies[0].principalVariation![0].to.row = 0;
    Object.assign(first.plies[0].evaluationBreakdown!, { total: 99 });
    expect(games.slice(1)).toEqual(savedOthers); expect(initialState).toEqual(before);
    const saved = structuredClone(result);
    shared.selectedAction!.to.col = 0;
    shared.principalVariation!.length = 0;
    Object.assign(shared.evaluationBreakdown!, { total: -99 });
    initialState.history[0].to.row = 0;
    expect(result).toEqual(saved); expect(settings).toEqual(settingsBefore);
  });
});
