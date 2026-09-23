import { describe, expect, it, vi } from 'vitest';
import {
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, cloneBoardState, createPositionKey,
  createPositionSnapshot, executeLegalAction, executeResignation, getLegalActions,
  runSelfPlayGame, type LegalAction, type SelfPlaySearchResult,
} from '../domain/shogi';
import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../types/shogi';

function position(): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  place(state, 8, 4, 'king', 'sente');
  place(state, 0, 4, 'king', 'gote');
  state.status = 'active';
  state.positionHistory = [];
  state.positionSnapshots = [];
  return state;
}

function place(state: BoardState, row: number, col: number, type: PieceType, player: Player) {
  state.squares[row][col].piece = { id: `${player}-${type}-${row}-${col}`, type, player };
}

function apply(state: BoardState, action: LegalAction): BoardState {
  const execution = executeLegalAction(cloneBoardState(state), action, { proposer: 'local_ai' });
  expect(execution.type).toBe('applied');
  if (execution.type !== 'applied') throw new Error('fixture must apply a legal action');
  return execution.state;
}

function observation(state: BoardState, action = getLegalActions(state)[0]): SelfPlaySearchResult {
  return {
    selectedAction: structuredClone(action), selectedEvaluation: null, completedDepth: null,
    elapsedMilliseconds: null, timedOut: null, principalVariation: null, evaluationBreakdown: null,
    visitedPositionCount: null, cutoffCount: null, skippedActionCount: null,
    quiescenceLeafCount: null, quiescenceVisitedPositionCount: null,
    quiescenceCutoffCount: null, quiescenceSkippedActionCount: null,
    totalVisitedPositionCount: null, totalCutoffCount: null, totalSkippedActionCount: null,
    totalQuiescenceLeafCount: null, totalQuiescenceVisitedPositionCount: null,
    totalQuiescenceCutoffCount: null, totalQuiescenceSkippedActionCount: null,
  };
}

function run(initialState = position(), maxPlies = 2, search: (state: BoardState) => SelfPlaySearchResult = observation) {
  return runSelfPlayGame({ initialState, maxPlies, sente: { search, settings: undefined }, gote: { search, settings: undefined } });
}

function move(state: BoardState, fromRow: number, fromCol: number, toRow: number, toCol: number) {
  const action = getLegalActions(state).find((a) => a.kind === 'move' && a.from.row === fromRow &&
    a.from.col === fromCol && a.to.row === toRow && a.to.col === toCol && a.promotion !== 'promote');
  if (!action) throw new Error('missing fixture move');
  return action;
}

describe('runSelfPlayGame', () => {
  it('alternates independent searches/settings and records pre-move keys through the public execution API', () => {
    const initialState = position();
    const calls: Array<{ state: BoardState; settings: unknown }> = [];
    const sente = { search: vi.fn((state: BoardState, settings: { depth: number }) => {
      calls.push({ state, settings }); return observation(state);
    }), settings: { depth: 1 } };
    const gote = { search: vi.fn((state: BoardState, settings: string) => {
      calls.push({ state, settings }); return observation(state);
    }), settings: 'another algorithm' };
    const result = runSelfPlayGame({ initialState, maxPlies: 4, sente, gote });
    expect(result.status).toBe('max_plies');
    expect(sente.search).toHaveBeenCalledTimes(2);
    expect(gote.search).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.settings)).toEqual([sente.settings, gote.settings, sente.settings, gote.settings]);
    expect(calls.map((c) => c.state.turn)).toEqual(['sente', 'gote', 'sente', 'gote']);
    let replay = cloneBoardState(initialState);
    for (const [index, record] of result.plies.entries()) {
      expect(record.ply).toBe(index + 1);
      expect(record.positionKey).toBe(createPositionKey(replay));
      expect(record.player).toBe(replay.turn);
      expect(getLegalActions(replay)).toContainEqual(record.action);
      expect(calls[index].state).toEqual(replay);
      replay = apply(replay, record.action);
      expect(record.selectedEvaluation).toBeNull();
      expect(record.totalVisitedPositionCount).toBeNull();
    }
    expect(result.finalState).toEqual(replay);
    expect(result.finalState.result).toBeNull();
    const roots = calls.map((c) => c.state);
    expect(new Set(roots).size).toBe(4);
    expect(new Set(roots.map((s) => s.squares)).size).toBe(4);
    expect(new Set(roots.map((s) => s.positionSnapshots)).size).toBe(4);
    expect(roots[0]).not.toBe(initialState);
    expect(() => { roots[0].history.length = 0; }).toThrow();
    expect(result.finalState).toEqual(replay);
  });

  it('starts with gote when the supplied position is gote to move', () => {
    const initialState = position(); initialState.turn = 'gote';
    const sente = { search: vi.fn((s: BoardState) => observation(s)), settings: 1 };
    const gote = { search: vi.fn((s: BoardState) => observation(s)), settings: 2 };
    expect(runSelfPlayGame({ initialState, maxPlies: 1, sente, gote }).plies[0].player).toBe('gote');
    expect(sente.search).not.toHaveBeenCalled(); expect(gote.search).toHaveBeenCalledTimes(1);
  });

  it('accepts the existing timed search directly via an adapter with a deterministic clock', () => {
    const initialState = position();
    const search = (state: BoardState, settings: { maxDepth: number; milliseconds: number }) =>
      analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, settings.maxDepth, settings.milliseconds, undefined, () => 0);
    const result = runSelfPlayGame({ initialState, maxPlies: 2,
      sente: { search, settings: { maxDepth: 1, milliseconds: 0 } },
      gote: { search, settings: { maxDepth: 2, milliseconds: 0 } },
    });
    expect(result.status).toBe('max_plies');
    expect(result.plies.map((r) => r.completedDepth)).toEqual([0, 0]);
    expect(result.plies.map((r) => r.timedOut)).toEqual([true, true]);
    expect(result.plies.map((r) => r.resultSource)).toEqual(['fallback', 'fallback']);
    expect(result.plies.every((r) => r.principalVariation?.length === 0 && r.evaluationBreakdown === null)).toBe(true);
  });

  it('stops on mate at the limit and preserves the existing decisive result, including a drop', () => {
    const initialState = position();
    place(initialState, 2, 3, 'gold', 'sente');
    place(initialState, 2, 1, 'bishop', 'sente');
    place(initialState, 2, 7, 'bishop', 'sente');
    initialState.senteHand = [{ id: 'rook', type: 'rook', player: 'sente' }];
    const action = getLegalActions(initialState).find((a) => a.kind === 'drop' && a.to.row === 1 && a.to.col === 4)!;
    const search = vi.fn((s: BoardState) => observation(s, action));
    const result = run(initialState, 1, search);
    expect(result.status).toBe('ended');
    expect(result.finalState).toEqual(apply(initialState, action));
    expect(result).toMatchObject({ gameResult: { endReason: 'checkmate', winner: 'sente', loser: 'gote' } });
    expect(result.plies).toHaveLength(1); expect(search).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('uses existing repetition adjudication (continuous checks=%s)', (checking) => {
    const initialState = position();
    if (checking) { initialState.squares[8][4].piece = null; place(initialState, 8, 8, 'king', 'sente'); place(initialState, 1, 3, 'rook', 'sente'); }
    const cycle = checking
      ? [[1, 3, 1, 4], [0, 4, 0, 3], [1, 4, 1, 3], [0, 3, 0, 4]]
      : [[8, 4, 8, 3], [0, 4, 0, 3], [8, 3, 8, 4], [0, 3, 0, 4]];
    let call = 0;
    const result = run(initialState, 20, (s) => {
      const [fr, fc, tr, tc] = cycle[call++ % 4]; return observation(s, move(s, fr, fc, tr, tc));
    });
    expect(result.status).toBe('ended'); expect(result.plies).toHaveLength(12);
    expect(result.finalState.result).toMatchObject(checking
      ? { endReason: 'foul_loss', foulReason: 'perpetual_check_repetition', loser: 'sente' }
      : { endReason: 'repetition', winner: null });
  });

  it('keeps the 500-move game rule separate from the relative research limit', () => {
    const initialState = position(); initialState.moveNumber = 499;
    const limited = run(initialState, 1);
    expect(limited.status).toBe('max_plies'); expect(limited.finalState.result).toBeNull();
    const ended = run(initialState, 2);
    expect(ended.status).toBe('ended'); expect(ended.plies).toHaveLength(2);
    expect(ended.finalState.result?.endReason).toBe('five_hundred_move_jishogi');
  });

  it('applies a semantically copied promotion/capture and rejects a non-representative drop ID', () => {
    const initialState = position();
    place(initialState, 3, 0, 'pawn', 'sente'); place(initialState, 2, 0, 'silver', 'gote');
    const action = getLegalActions(initialState).find((a) => a.kind === 'move' && a.promotion === 'promote')!;
    const result = run(initialState, 1, (s) => observation(s, structuredClone(action)));
    expect(result.status).toBe('max_plies');
    expect(result.finalState).toEqual(apply(initialState, action));
    expect(result.finalState.squares[2][0].piece?.isPromoted).toBe(true);
    expect(result.finalState.senteHand[0].type).toBe('silver');
    initialState.senteHand = [{ id: 'a', type: 'gold', player: 'sente' }, { id: 'b', type: 'gold', player: 'sente' }];
    const drop = getLegalActions(initialState).find((a) => a.kind === 'drop')!;
    expect(run(initialState, 1, (s) => observation(s, { ...drop, pieceId: 'b' } as LegalAction)))
      .toMatchObject({ status: 'failed', failure: { code: 'illegal_action' } });
  });

  it('preserves infinite terminal evaluation and its independently copied breakdown', () => {
    const initialState = position(); initialState.moveNumber = 500;
    const result = run(initialState, 1, (s) =>
      analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 1, 1000, undefined, () => 0));
    expect(result.status).toBe('ended');
    expect(result.plies[0]).toMatchObject({ selectedEvaluation: 0, evaluationBreakdown: { terminal: 'draw', total: 0 } });
    const mateState = position();
    place(mateState, 2, 3, 'gold', 'sente'); place(mateState, 2, 1, 'bishop', 'sente'); place(mateState, 2, 7, 'bishop', 'sente');
    mateState.senteHand = [{ id: 'r', type: 'rook', player: 'sente' }];
    const action = getLegalActions(mateState).find((a) => a.kind === 'drop' && a.to.row === 1 && a.to.col === 4)!;
    const mateResult = run(mateState, 1, (s) => ({ ...observation(s, action), selectedEvaluation: Infinity,
      principalVariation: [action], evaluationBreakdown: { total: Infinity, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: 'win' } }));
    expect(mateResult.status).toBe('ended');
    expect(mateResult.plies[0].selectedEvaluation).toBe(Infinity);
  });

  it.each([0, 10])('does not search an already ended position (limit %s)', (maxPlies) => {
    const initialState = executeResignation(position()).state;
    const search = vi.fn((s: BoardState) => observation(s));
    const result = run(initialState, maxPlies, search);
    expect(result.status).toBe('ended'); expect(result.plies).toEqual([]);
    expect(result).toMatchObject({ gameResult: initialState.result });
    expect(search).not.toHaveBeenCalled();
    expect(result.finalState.result).not.toBe(initialState.result);
    if (result.status === 'ended') expect(result.gameResult).not.toBe(result.finalState.result);
  });

  it('returns a zero-ply research stop without a fabricated GameResult', () => {
    const search = vi.fn((s: BoardState) => observation(s)); const result = run(position(), 0, search);
    expect(result.status).toBe('max_plies'); expect(result.plies).toEqual([]);
    expect(result.finalState.status).toBe('active'); expect(result.finalState.result).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, '2', null, undefined])('rejects invalid maxPlies %s', (limit) => {
    const search = vi.fn((s: BoardState) => observation(s));
    const result = runSelfPlayGame({ initialState: position(), maxPlies: limit as number,
      sente: { search, settings: null }, gote: { search, settings: null } });
    expect(result).toMatchObject({ status: 'failed', failure: { stage: 'options', code: 'invalid_max_plies', ply: 1, player: 'sente' } });
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    ['no action', (r: SelfPlaySearchResult) => { r.selectedAction = null; }, 'missing_action'],
    ['wrong turn', (r: SelfPlaySearchResult) => { r.selectedAction!.player = 'gote'; }, 'wrong_player'],
    ['illegal move', (r: SelfPlaySearchResult) => { r.selectedAction!.to = { row: 4, col: 4 }; }, 'illegal_action'],
    ['malformed action', (r: SelfPlaySearchResult) => { r.selectedAction = {} as LegalAction; }, 'invalid_result'],
    ['NaN score', (r: SelfPlaySearchResult) => { r.selectedEvaluation = NaN; }, 'invalid_result'],
    ['negative count', (r: SelfPlaySearchResult) => { r.cutoffCount = -1; }, 'invalid_result'],
    ['fractional depth', (r: SelfPlaySearchResult) => { r.completedDepth = 1.5; }, 'invalid_result'],
    ['infinite time', (r: SelfPlaySearchResult) => { r.elapsedMilliseconds = Infinity; }, 'invalid_result'],
    ['missing timedOut', (r: SelfPlaySearchResult) => { delete (r as Partial<SelfPlaySearchResult>).timedOut; }, 'invalid_result'],
    ['bad totals', (r: SelfPlaySearchResult) => { r.visitedPositionCount = 2; r.totalVisitedPositionCount = 1; }, 'invalid_result'],
    ['broken PV', (r: SelfPlaySearchResult) => { r.principalVariation = [r.selectedAction!, r.selectedAction!]; }, 'invalid_result'],
    ['empty PV', (r: SelfPlaySearchResult) => { r.principalVariation = []; }, 'invalid_result'],
    ['bad breakdown', (r: SelfPlaySearchResult) => { r.evaluationBreakdown = { total: 10, material: 0, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: null }; }, 'invalid_result'],
  ] as const)('rejects %s without applying the failing ply', (_label, change, code) => {
    const initialState = position();
    const result = run(initialState, 2, (s) => { const r = observation(s); change(r); return r; });
    expect(result).toMatchObject({ status: 'failed', failure: { stage: 'result', code, ply: 1, player: 'sente' } });
    expect(result.plies).toEqual([]); expect(result.finalState).toEqual(cloneBoardState(initialState));
    expect(result.finalState.result).toBeNull();
  });

  it.each([null, undefined, 42, 'result', {}, Promise.resolve({})])('rejects malformed/synchronous-contract result %#', (value) => {
    expect(run(position(), 1, () => value as SelfPlaySearchResult)).toMatchObject({ status: 'failed', failure: { code: 'invalid_result' } });
  });

  const mutations: Array<[string, (s: BoardState) => void]> = [
    ['root', (s) => { s.turn = 'gote'; }],
    ['piece', (s) => { s.squares[0][4].piece!.type = 'pawn'; }],
    ['hand', (s) => { s.senteHand[0].type = 'rook'; }],
    ['history', (s) => { s.history[0].to.row = 0; }],
    ['positionHistory', (s) => { s.positionHistory![0].key = 'changed'; }],
    ['positionSnapshots', (s) => { s.positionSnapshots![0].squares[0][4].piece!.type = 'gold'; }],
    ['delete', (s) => { delete s.lastMove; }],
    ['define', (s) => { Object.defineProperty(s, 'turn', { value: 'sente' }); }],
    ['prototype', (s) => { Object.setPrototypeOf(s, {}); }],
    ['descriptor access', (s) => { Object.getOwnPropertyDescriptor(s, 'squares')!.value[0][4].piece.type = 'pawn'; }],
  ];
  it.each(mutations)('detects a caught mutation attempt on %s and protects all caller data', (_name, mutate) => {
    let initialState = position();
    initialState.senteHand = [{ id: 'hand', type: 'gold', player: 'sente' }];
    initialState = apply(initialState, getLegalActions(initialState)[0]);
    const before = structuredClone(initialState);
    const result = run(initialState, 1, (s) => {
      try { mutate(s); } catch { /* A search cannot hide its mutation attempt. */ }
      return observation(s);
    });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'input_mutation', stage: 'search', ply: 1, player: 'gote' } });
    expect(result.finalState).toEqual(cloneBoardState(before));
    expect(initialState).toEqual(before); expect(result.plies).toEqual([]);
  });

  it('detects uncaught writes, and preserves completed plies for an exception with its cause', () => {
    expect(run(position(), 1, (s) => { s.history.push({} as never); return observation(s); }))
      .toMatchObject({ status: 'failed', failure: { code: 'input_mutation' } });
    const initialState = position(); let count = 0;
    const result = run(initialState, 5, (s) => {
      if (++count === 2) throw new Error('fixture search crashed');
      return observation(s);
    });
    expect(result).toMatchObject({ status: 'failed', failure: { ply: 2, player: 'gote', stage: 'search', code: 'search_exception', message: 'fixture search crashed' } });
    expect(result.plies).toHaveLength(1);
    expect(result.finalState).toEqual(apply(initialState, result.plies[0].action));
  });

  it('retains earlier observations when a reused search result later violates its contract', () => {
    const initialState = position();
    const shared = observation(initialState);
    const originalAction = structuredClone(shared.selectedAction);
    let call = 0;
    const result = run(initialState, 3, (s) => {
      Object.assign(shared, observation(s));
      if (++call === 2) shared.selectedAction = null;
      return shared;
    });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'missing_action', ply: 2, player: 'gote' } });
    expect(result.plies).toHaveLength(1); expect(result.plies[0].action).toEqual(originalAction);
    expect(result.finalState).toEqual(apply(initialState, originalAction!));
  });

  it('copies all observations per ply and isolates actions, PV, breakdown, final state and caller histories', () => {
    let initialState = position();
    initialState.senteHand = [{ id: 'sp', type: 'pawn', player: 'sente' }];
    initialState.goteHand = [{ id: 'gp', type: 'pawn', player: 'gote' }];
    initialState.positionSnapshots = [createPositionSnapshot(initialState)];
    initialState = apply(initialState, getLegalActions(initialState)[0]);
    const before = structuredClone(initialState);
    const sources: SelfPlaySearchResult[] = [];
    const result = run(initialState, 2, (s) => {
      const n = sources.length + 1;
      const r: SelfPlaySearchResult = { ...observation(s),
        selectedEvaluation: n, completedDepth: n, elapsedMilliseconds: n * 0.5, timedOut: n === 2,
        visitedPositionCount: n * 10, cutoffCount: n, skippedActionCount: n * 2,
        quiescenceLeafCount: n * 3, quiescenceVisitedPositionCount: n * 4, quiescenceCutoffCount: n, quiescenceSkippedActionCount: n * 2,
        totalVisitedPositionCount: n * 20, totalCutoffCount: n * 2, totalSkippedActionCount: n * 4,
        totalQuiescenceLeafCount: n * 6, totalQuiescenceVisitedPositionCount: n * 8, totalQuiescenceCutoffCount: n * 2, totalQuiescenceSkippedActionCount: n * 4,
        evaluationBreakdown: { total: n, material: n, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0, terminal: null },
      };
      r.principalVariation = [r.selectedAction!]; sources.push(r); return r;
    });
    expect(result.status).toBe('max_plies'); expect(initialState).toEqual(before);
    for (const [i, record] of result.plies.entries()) {
      const { selectedAction, ...observations } = sources[i];
      expect(record).toMatchObject(observations);
      expect(record.action).toEqual(selectedAction); expect(record.action).not.toBe(selectedAction);
      expect(record.principalVariation![0]).not.toBe(selectedAction);
      expect(record.principalVariation![0]).not.toBe(record.action);
      expect(record.evaluationBreakdown).not.toBe(sources[i].evaluationBreakdown);
    }
    const saved = structuredClone(result);
    sources[0].selectedAction!.to.row = 0;
    sources[0].principalVariation!.length = 0;
    sources[0].evaluationBreakdown = null;
    Object.assign(sources[1].evaluationBreakdown!, { total: 99 });
    initialState.history[0].to.col = 0;
    initialState.positionHistory![0].key = 'changed';
    initialState.positionSnapshots![0].squares[0][4].piece!.type = 'rook';
    initialState.senteHand[0].type = 'rook'; initialState.goteHand[0].type = 'rook';
    initialState.squares[0][4].piece!.type = 'pawn';
    expect(result).toEqual(saved);
    result.plies[0].action.to.col = 0;
    expect(result.finalState).toEqual(saved.finalState);
    expect(result.plies[0].principalVariation).toEqual(saved.plies[0].principalVariation);
  });
});
