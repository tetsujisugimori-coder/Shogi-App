import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, cloneBoardState, createPositionSnapshot,
  executeLegalAction, getLegalActions, runPairedSelfPlayMatch, runSelfPlayGame,
  type LegalAction, type PairedSelfPlayGame, type PairedSelfPlayMatchResult,
  type PairedSelfPlayOutcome, type PairedSelfPlayParticipantId, type SelfPlaySearchResult,
} from '../domain/shogi';
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
  expect(execution.type).toBe('applied');
  if (execution.type !== 'applied') throw new Error('fixture action must apply');
  return execution.state;
}

function move(state: BoardState, fr: number, fc: number, tr: number, tc: number): LegalAction {
  const action = getLegalActions(state).find((a) => a.kind === 'move' &&
    a.from.row === fr && a.from.col === fc && a.to.row === tr && a.to.col === tc && a.promotion !== 'promote');
  if (!action) throw new Error('fixture move must be legal');
  return action;
}

function run(initialState: BoardState, maxPlies: number,
  search: (state: BoardState) => SelfPlaySearchResult = observation) {
  return runPairedSelfPlayMatch({ initialState, maxPlies,
    a: { search, settings: undefined }, b: { search, settings: undefined } });
}

function expectSummary(result: PairedSelfPlayMatchResult, outcomes: [PairedSelfPlayOutcome, PairedSelfPlayOutcome]) {
  expect(result.games).toHaveLength(2);
  expect(result.games.map((g) => g.outcome)).toEqual(outcomes);
  expect(result.summary).toEqual({
    aWins: outcomes.filter((o) => o === 'a_win').length,
    bWins: outcomes.filter((o) => o === 'b_win').length,
    draws: outcomes.filter((o) => o === 'draw').length,
    maxPlies: outcomes.filter((o) => o === 'max_plies').length,
    failures: outcomes.filter((o) => o === 'failed').length,
  });
  expect(Object.values(result.summary).reduce((a, b) => a + b, 0)).toBe(2);
}

/** Enumerate every nested mutable reference, including coordinates and pieces. */
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

function matePosition(winner: Player): BoardState {
  const row = (r: number) => winner === 'sente' ? r : 8 - r;
  const state = position(winner, [
    [row(2), 3, { id: 'guard', type: 'gold', player: winner }],
    [row(2), 1, { id: 'left', type: 'bishop', player: winner }],
    [row(2), 7, { id: 'right', type: 'bishop', player: winner }],
  ]);
  state[winner === 'sente' ? 'senteHand' : 'goteHand'] = [{ id: 'rook', type: 'rook', player: winner }];
  state.positionSnapshots = [createPositionSnapshot(state)];
  return state;
}

function mateSearch(state: BoardState): SelfPlaySearchResult {
  const action = getLegalActions(state).find((a) => a.kind === 'drop' &&
    a.to.row === (state.turn === 'sente' ? 1 : 7) && a.to.col === 4);
  if (!action) throw new Error('fixture mating drop must exist');
  return observation(state, action);
}

describe('runPairedSelfPlayMatch', () => {
  it.each(['sente', 'gote'] as const)('runs exactly two games with different settings types, respecting %s to move', (turn) => {
    const initialState = position(turn);
    const before = structuredClone(initialState);
    const calls: Array<{ id: PairedSelfPlayParticipantId; state: BoardState; settings: unknown }> = [];
    const a = { settings: { depth: 1 }, search: vi.fn((state: BoardState, settings: { depth: number }) => {
      calls.push({ id: 'A', state, settings }); return observation(state);
    }) };
    const b = { settings: 'deterministic B', search: vi.fn((state: BoardState, settings: string) => {
      calls.push({ id: 'B', state, settings }); return observation(state);
    }) };
    const result = runPairedSelfPlayMatch({ initialState, a, b, maxPlies: 2 });
    expectSummary(result, ['max_plies', 'max_plies']);
    expect(result.games).toMatchObject([
      { gameNumber: 1, sente: 'A', gote: 'B' }, { gameNumber: 2, sente: 'B', gote: 'A' },
    ]);
    expectTypeOf(result.games[0].sente).toEqualTypeOf<'A'>();
    expectTypeOf(result.games[1].gote).toEqualTypeOf<'A'>();
    const game: PairedSelfPlayGame = result.games[0];
    if (game.gameNumber === 1) expectTypeOf(game.gote).toEqualTypeOf<'B'>();
    expect(a.search).toHaveBeenCalledTimes(2);
    expect(b.search).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.id)).toEqual(turn === 'sente' ? ['A', 'B', 'B', 'A'] : ['B', 'A', 'A', 'B']);
    for (const call of calls) expect(call.settings).toBe(call.id === 'A' ? a.settings : b.settings);
    expect(calls[0].state).toEqual(cloneBoardState(before));
    expect(calls[2].state).toEqual(calls[0].state);
    expectDisjoint(calls[0].state, calls[2].state);
    expect(initialState).toEqual(before);
    // Compare the entire results, not only statuses, with the existing API.
    expect(result.games[0].result).toEqual(runSelfPlayGame({ initialState, sente: a, gote: b, maxPlies: 2 }));
    expect(result.games[1].result).toEqual(runSelfPlayGame({ initialState, sente: b, gote: a, maxPlies: 2 }));
  });

  it.each(['sente', 'gote'] as const)('maps a legal %s mating win to both A/B seats', (winner) => {
    const initialState = matePosition(winner);
    const result = run(initialState, 1, mateSearch);
    expectSummary(result, winner === 'sente' ? ['a_win', 'b_win'] : ['b_win', 'a_win']);
    for (const game of result.games) {
      expect(game.result).toMatchObject({ status: 'ended', gameResult: { endReason: 'checkmate', winner } });
      expect(game.result.plies).toHaveLength(1);
      expect(game.result.finalState).toEqual(apply(initialState, mateSearch(initialState).selectedAction!));
    }
  });

  it.each([false, true])('preserves repetition adjudication (continuous checks=%s) in both games', (checking) => {
    const initialState = position('sente', checking ? [[1, 3, { id: 'r', type: 'rook', player: 'sente' }]] : []);
    const cycle = checking
      ? [[1, 3, 1, 4], [0, 4, 0, 3], [1, 4, 1, 3], [0, 3, 0, 4]]
      : [[8, 4, 8, 3], [0, 4, 0, 3], [8, 3, 8, 4], [0, 3, 0, 4]];
    const result = run(initialState, 20, (s) => {
      const [fr, fc, tr, tc] = cycle[s.history.length % cycle.length];
      return observation(s, move(s, fr, fc, tr, tc));
    });
    expectSummary(result, checking ? ['b_win', 'a_win'] : ['draw', 'draw']);
    for (const game of result.games) {
      expect(game.result.plies).toHaveLength(12);
      expect(game.result).toMatchObject({ status: 'ended', gameResult: checking
        ? { endReason: 'foul_loss', foulReason: 'perpetual_check_repetition', loser: 'sente', winner: 'gote' }
        : { endReason: 'repetition', winner: null } });
    }
  });

  it('distinguishes the 500-move draw from the relative maxPlies stop', () => {
    const initialState = position(); initialState.moveNumber = 499;
    expectSummary(run(initialState, 1), ['max_plies', 'max_plies']);
    const result = run(initialState, 2);
    expectSummary(result, ['draw', 'draw']);
    for (const game of result.games) expect(game.result).toMatchObject({
      status: 'ended', gameResult: { endReason: 'five_hundred_move_jishogi', winner: null },
    });
  });

  it.each(['sente', 'gote'] as const)('records a seat-dependent %s search failure without awarding a win', (failingSeat) => {
    const initialState = position();
    const a = { settings: null, search: vi.fn((s: BoardState) => {
      if (s.turn === failingSeat) throw new Error('seat-dependent failure');
      return observation(s);
    }) };
    const b = { settings: null, search: vi.fn((s: BoardState) => observation(s)) };
    const result = runPairedSelfPlayMatch({ initialState, a, b, maxPlies: 2 });
    expectSummary(result, failingSeat === 'sente' ? ['failed', 'max_plies'] : ['max_plies', 'failed']);
    const failed = result.games[failingSeat === 'sente' ? 0 : 1].result;
    expect(failed).toMatchObject({ status: 'failed', failure: {
      stage: 'search', code: 'search_exception', player: failingSeat,
      ply: failingSeat === 'sente' ? 1 : 2, message: 'seat-dependent failure',
    } });
    expect(failed.plies).toHaveLength(failingSeat === 'sente' ? 0 : 1);
    expect(a.search).toHaveBeenCalledTimes(2);
    expect(b.search).toHaveBeenCalledTimes(failingSeat === 'sente' ? 1 : 2);
  });

  it('continues after an input mutation attempt without changing the second start', () => {
    const initialState = position(); const before = structuredClone(initialState);
    const a = { settings: null, search: (s: BoardState) => {
      if (s.turn === 'sente') s.squares[0][4].piece!.type = 'pawn';
      return observation(s);
    } };
    const b = { settings: null, search: vi.fn((s: BoardState) => observation(s)) };
    const result = runPairedSelfPlayMatch({ initialState, a, b, maxPlies: 1 });
    expectSummary(result, ['failed', 'max_plies']);
    expect(result.games[0].result).toMatchObject({ failure: { code: 'input_mutation' } });
    expect(b.search.mock.calls[0][0]).toEqual(cloneBoardState(before));
    expect(initialState).toEqual(before);
  });

  it.each([0, 3])('delegates an already ended start without searching (maxPlies=%s)', (maxPlies) => {
    const start = matePosition('sente');
    const initialState = apply(start, mateSearch(start).selectedAction!);
    const search = vi.fn((s: BoardState) => observation(s));
    const result = run(initialState, maxPlies, search);
    expectSummary(result, ['a_win', 'b_win']);
    const single = runSelfPlayGame({ initialState, maxPlies,
      sente: { search, settings: null }, gote: { search, settings: null } });
    for (const game of result.games) expect(game.result).toEqual(single);
    expect(search).not.toHaveBeenCalled();
    expectDisjoint(result.games[0].result, result.games[1].result);
    expectDisjoint(result, initialState);
  });

  it('returns two zero-ply stops without calling either search', () => {
    const search = vi.fn((s: BoardState) => observation(s));
    const result = run(position(), 0, search);
    expectSummary(result, ['max_plies', 'max_plies']);
    for (const game of result.games) expect(game.result.plies).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, '2', null, undefined])('passes invalid maxPlies %s unchanged to each game', (maxPlies) => {
    const initialState = position(); const search = vi.fn((s: BoardState) => observation(s));
    const result = run(initialState, maxPlies as number, search);
    expectSummary(result, ['failed', 'failed']);
    for (const game of result.games) expect(game.result).toMatchObject({
      status: 'failed', failure: { code: 'invalid_max_plies', stage: 'options', ply: 1 }, plies: [],
    });
    expect(search).not.toHaveBeenCalled();
    expectDisjoint(result.games[0].result, result.games[1].result);
  });

  it('isolates all nested results and reused search observations, and repeats deterministically', () => {
    let initialState = position();
    initialState.senteHand = [{ id: 'sp', type: 'pawn', player: 'sente' }];
    initialState.goteHand = [{ id: 'gp', type: 'pawn', player: 'gote' }];
    initialState.positionSnapshots = [createPositionSnapshot(initialState)];
    initialState = apply(initialState, getLegalActions(initialState)[0]);
    const before = structuredClone(initialState);
    const shared = observation(initialState);
    const search = (s: BoardState): SelfPlaySearchResult => {
      Object.assign(shared, observation(s));
      shared.principalVariation = [shared.selectedAction!];
      shared.selectedEvaluation = 3;
      shared.evaluationBreakdown = { total: 3, material: 3, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: null };
      return shared;
    };
    const result = run(initialState, 2, search);
    expectSummary(result, ['max_plies', 'max_plies']);
    expect(run(initialState, 2, search)).toEqual(result);
    const [first, second] = result.games.map((game) => game.result);
    expect(first.plies).toHaveLength(2); expect(second.plies).toHaveLength(2);
    expectDisjoint(first, second); expectDisjoint(result, initialState); expectDisjoint(result, shared);
    for (const game of [first, second]) {
      expectDisjoint(game.plies[0], game.plies[1]);
      for (const ply of game.plies) {
        expect(ply.principalVariation).toEqual([ply.action]);
        expect(ply.evaluationBreakdown?.total).toBe(3);
      }
    }
    const savedSecond = structuredClone(second);
    first.finalState.senteHand[0].type = 'rook';
    first.finalState.goteHand[0].type = 'rook';
    first.finalState.history[0].to.col = 0;
    first.finalState.positionHistory![0].key = 'changed';
    first.finalState.positionSnapshots![0].squares[0][4].piece!.type = 'pawn';
    first.plies[0].action.to.col = 0;
    first.plies[0].principalVariation![0].to.row = 0;
    Object.assign(first.plies[0].evaluationBreakdown!, { total: 99 });
    expect(second).toEqual(savedSecond); expect(initialState).toEqual(before);
    const saved = structuredClone(result);
    shared.selectedAction!.to.col = 0;
    shared.principalVariation!.length = 0;
    Object.assign(shared.evaluationBreakdown!, { total: -99 });
    initialState.history[0].to.row = 0;
    expect(result).toEqual(saved);
  });

  it('starts each injected timed search with its own deterministic clock', () => {
    const initialState = position();
    const clocks: Array<() => number> = [];
    const search = (s: BoardState, settings: { maxDepth: number }) => {
      const clock = () => 0; clocks.push(clock);
      return analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, settings.maxDepth, 0, undefined, clock);
    };
    const result = runPairedSelfPlayMatch({ initialState, maxPlies: 2,
      a: { search, settings: { maxDepth: 1 } }, b: { search, settings: { maxDepth: 2 } } });
    expectSummary(result, ['max_plies', 'max_plies']);
    expect(new Set(clocks).size).toBe(4);
    expect(result.games.map((g) => g.result.plies.map((p) => p.timedOut))).toEqual([[false, true], [true, false]]);
  });
});
