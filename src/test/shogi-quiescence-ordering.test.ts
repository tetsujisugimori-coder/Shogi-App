// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../types/shogi';
import { analyzeAlphaBetaSearch, analyzeIterativeDeepeningAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  analyzeTwoPlyAlphaBetaSearch, selectBestAlphaBetaAction, selectBestIterativeDeepeningAlphaBetaAction, selectBestTwoPlyAlphaBetaAction,
  analyzeQuiescenceSearch, DEFAULT_MATERIAL_VALUE_TABLE as table, evaluateSearchPositionBreakdown,
  executeLegalAction, getLegalActions, isPlayerInCheck, type LegalAction, type MaterialValueTable } from '../domain/shogi';
import { orderQuiescenceCandidates } from '../domain/shogi/quiescenceOrdering';
import { createComparisonSnapshot } from '../domain/shogi/evaluationPresetComparison';
import * as legal from '../domain/shogi/legalActions';
import * as see from '../domain/shogi/staticExchangeEvaluation';
import * as evaluation from '../domain/shogi/twoPlyMinimaxAi';
import { QUIESCENCE_BENCHMARK_POSITIONS as positions } from '../../scripts/benchmarks/quiescencePositions';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
type Placement = [number, number, PieceType, Player, boolean?];
function position(placements: Placement[], turn: Player = 'sente'): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  for (const [row, col, type, player, isPromoted] of [[8, 8, 'king', 'sente'], [0, 8, 'king', 'gote'], ...placements] as Placement[]) {
    state.squares[row][col].piece = { id: `${row}-${col}`, type, player, isPromoted };
  }
  state.turn = turn;
  return state;
}
const captureActions = (state: BoardState) => getLegalActions(state).filter(a => a.kind === 'move' && state.squares[a.to.row][a.to.col].piece);
const order = (state: BoardState, actions = captureActions(state), values: MaterialValueTable = table) => orderQuiescenceCandidates(state, actions, 'material', values);
const captureBoard = () => position([[4, 4, 'rook', 'sente'], [4, 2, 'pawn', 'gote'], [4, 6, 'silver', 'gote']]);
afterEach(() => vi.restoreAllMocks());

describe('lightweight quiescence candidate ordering', () => {
  it('keeps the original frozen array and generation order without inspecting material', () => {
    const state = freeze(captureBoard());
    const actions = freeze(getLegalActions(state));
    expect(orderQuiescenceCandidates(state, actions, 'original', table)).toBe(actions);
    const omitted = analyzeQuiescenceSearch(state, 'sente', 2);
    expect(analyzeQuiescenceSearch(state, 'sente', 2, undefined, undefined, 'original')).toEqual(omitted);
  });
  it('prioritizes larger captured board plus hand gain', () => {
    const state = captureBoard();
    const actions = captureActions(state);
    expect(actions.map(a => a.to.col)).toEqual([2, 6]);
    expect(order(state, actions).map(a => a.to.col)).toEqual([6, 2]);
  });
  it('executes original candidates in generated order and resolves custom values inside material search', () => {
    const state = freeze(captureBoard());
    const actions = captureActions(state);
    const execute = vi.spyOn(legal, 'executeLegalAction');
    analyzeQuiescenceSearch(state, 'sente', 1, undefined, undefined, 'original');
    expect(execute.mock.calls.map(call => call[1])).toEqual(actions);
    execute.mockClear();
    const custom = freeze({ unpromoted: { ...table.unpromoted, pawn: 900 }, promoted: { ...table.promoted } });
    analyzeQuiescenceSearch(state, 'sente', 1, { materialValueTable: custom }, undefined, 'material');
    expect(execute.mock.calls.map(call => call[1])).toEqual(order(state, actions, custom));
  });
  it('breaks equal capture gain by promotion increase', () => {
    const state = positions.find(p => p.id === 'promotion-capture')!.create();
    const actions = captureActions(state);
    expect(actions).toHaveLength(2);
    expect(order(state, actions).map(a => a.promotion)).toEqual(['promote', 'decline']);
  });
  it('breaks equal gain and promotion by lower attacker board value', () => {
    const state = position([[4, 4, 'rook', 'sente'], [5, 2, 'silver', 'sente'], [4, 2, 'pawn', 'gote']]);
    const actions = captureActions(state);
    expect(actions.map(a => a.pieceType)).toEqual(['rook', 'silver']);
    expect(order(state, actions).map(a => a.pieceType)).toEqual(['silver', 'rook']);
  });
  it('preserves exact input order on full ties, including reversed candidate order', () => {
    const state = position([[4, 4, 'rook', 'sente'], [4, 2, 'pawn', 'gote'], [4, 6, 'pawn', 'gote']]);
    const actions = captureActions(state);
    expect(actions).toHaveLength(2);
    expect(order(state, actions)).toEqual(actions);
    expect(order(state, [...actions].reverse())).toEqual([...actions].reverse());
  });
  it('distinguishes promoted board loss from the unpromoted hand gain', () => {
    // Promoted pawn: 500+100=600; silver: 400+400=800.
    // Using board value alone or treating the hand piece as promoted reverses this.
    const state = position([[4, 4, 'rook', 'sente'], [4, 2, 'pawn', 'gote', true], [4, 6, 'silver', 'gote']]);
    expect(order(state).map(a => a.to.col)).toEqual([6, 2]);
  });
  it('uses custom material values, with no mutation, generation, execution, evaluation or SEE', () => {
    const state = freeze(captureBoard());
    const actions = freeze(captureActions(state));
    const custom = freeze({ unpromoted: { ...table.unpromoted, pawn: 900 }, promoted: { ...table.promoted } });
    const generate = vi.spyOn(legal, 'getLegalActions');
    const execute = vi.spyOn(legal, 'executeLegalAction');
    const evaluate = vi.spyOn(evaluation, 'evaluateSearchPositionBreakdown');
    const prepare = vi.spyOn(see, 'prepareStaticExchangeEvaluation');
    const exchange = vi.spyOn(see, 'evaluateStaticExchange');
    const first = order(state, actions, custom);
    expect(first.map(a => a.to.col)).toEqual([2, 6]);
    expect(order(state, actions, custom)).toEqual(first);
    for (const spy of [generate, execute, evaluate, prepare, exchange]) expect(spy).not.toHaveBeenCalled();
  });
  it('orders rotated and player-swapped actions symmetrically', () => {
    const state = captureBoard();
    const rotated = structuredClone(state);
    rotated.turn = 'gote';
    for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
      const piece = state.squares[8 - row][8 - col].piece;
      rotated.squares[row][col].piece = piece ? { ...piece, player: piece.player === 'sente' ? 'gote' : 'sente' } : null;
    }
    const rotate = (a: LegalAction): LegalAction => ({ ...a, player: a.player === 'sente' ? 'gote' : 'sente',
      to: { row: 8 - a.to.row, col: 8 - a.to.col },
      ...(a.kind === 'move' ? { from: { row: 8 - a.from.row, col: 8 - a.from.col } } : {}),
    });
    const actions = captureActions(state);
    expect(order(rotated, actions.map(rotate))).toEqual(order(state, actions).map(rotate));
    expect(analyzeQuiescenceSearch(rotated, 'gote', 2, undefined, undefined, 'material').selectedEvaluation)
      .toBe(analyzeQuiescenceSearch(state, 'sente', 2, undefined, undefined, 'material').selectedEvaluation);
  });
  it('retains every capture, king move, board interposition and drop in check', () => {
    const state = positions.find(p => p.id === 'gold-drop-evasion')!.create();
    state.squares[5][3].piece = { id: 'silver', type: 'silver', player: 'sente' };
    expect(isPlayerInCheck(state, state.turn)).toBe(true);
    const actions = freeze(getLegalActions(state));
    const captures = actions.filter(a => a.kind === 'move' && state.squares[a.to.row][a.to.col].piece);
    expect(captures.length).toBeGreaterThan(0);
    expect(actions.some(a => a.kind === 'move' && a.pieceType === 'king')).toBe(true);
    expect(actions.some(a => a.kind === 'move' && a.pieceType === 'silver' && !captures.includes(a))).toBe(true);
    expect(actions.some(a => a.kind === 'drop')).toBe(true);
    const ordered = orderQuiescenceCandidates(freeze(state), actions, 'material', table);
    expect(ordered).toHaveLength(actions.length);
    expect(new Set(ordered)).toEqual(new Set(actions));
    expect(ordered.slice(captures.length)).toEqual(actions.filter(a => !captures.includes(a)));
    const executed = vi.spyOn(legal, 'executeLegalAction');
    analyzeQuiescenceSearch(state, 'sente', 1, undefined, undefined, 'material');
    expect(executed.mock.calls.map(call => call[1])).toEqual(ordered);
  });
  it('executes only captures outside check and never invokes either SEE API', () => {
    const state = captureBoard();
    const expected = order(state);
    const execute = vi.spyOn(legal, 'executeLegalAction');
    const prepare = vi.spyOn(see, 'prepareStaticExchangeEvaluation');
    const exchange = vi.spyOn(see, 'evaluateStaticExchange');
    analyzeQuiescenceSearch(state, 'sente', 1, undefined, undefined, 'material');
    expect(execute.mock.calls.map(call => call[1])).toEqual(expected);
    analyzeAlphaBetaSearch(state, 1, undefined, () => 0, { quiescence: { maxTacticalDepth: 2, moveOrdering: 'material' } });
    expect(prepare).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });
  it('propagates interruption during decoration and sorting without partial results', () => {
    const state = captureBoard(), actions = captureActions(state), stop = new Error('stop ordering');
    for (const throwAt of [1, actions.length + 1]) {
      let calls = 0;
      expect(() => orderQuiescenceCandidates(state, actions, 'material', table, () => { if (++calls === throwAt) throw stop; })).toThrow(stop);
    }
    let calls = 0;
    expect(() => analyzeQuiescenceSearch(state, 'sente', 2, undefined, () => { if (++calls === 3) throw stop; }, 'material')).toThrow(stop);
  });
});

describe('quiescence ordering integration', () => {
  it('preserves depth-zero, terminal and checked no-response behavior in both modes', () => {
    const state = positions.find(p => p.id === 'rook-check')!.create();
    expect(analyzeQuiescenceSearch(state, 'sente', 0, undefined, undefined, 'material'))
      .toEqual(analyzeQuiescenceSearch(state, 'sente', 0));
    const ended: BoardState = { ...state, status: 'ended', result: { winner: 'gote', loser: 'sente', endReason: 'resignation' } };
    expect(analyzeQuiescenceSearch(ended, 'sente', 2, undefined, undefined, 'material'))
      .toEqual(analyzeQuiescenceSearch(ended, 'sente', 2));
    const generate = vi.spyOn(legal, 'getLegalActions').mockReturnValue([]);
    expect(analyzeQuiescenceSearch(state, 'sente', 2, undefined, undefined, 'material'))
      .toEqual(analyzeQuiescenceSearch(state, 'sente', 2));
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('keeps omitted and explicit original results identical across every search entry point', () => {
    const state = freeze(captureBoard());
    const omitted = freeze({ quiescence: { maxTacticalDepth: 1 } });
    const original = freeze({ quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' } } as const);
    for (const search of [analyzeAlphaBetaSearch, analyzeIterativeDeepeningAlphaBetaSearch]) {
      expect(search(state, 2, undefined, () => 0, original)).toEqual(search(state, 2, undefined, () => 0, omitted));
    }
    expect(analyzeTwoPlyAlphaBetaSearch(state, undefined, () => 0, original)).toEqual(analyzeTwoPlyAlphaBetaSearch(state, undefined, () => 0, omitted));
    expect(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 1000, undefined, () => 0, original))
      .toEqual(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 1000, undefined, () => 0, omitted));
  });
  it('propagates material and custom tables through fixed, iterative, timed, compatibility and selectors', () => {
    const state = freeze(captureBoard());
    const config = freeze({ materialValueTable: { unpromoted: { ...table.unpromoted, pawn: 900 }, promoted: { ...table.promoted } } });
    const options = freeze({ quiescence: { maxTacticalDepth: 1, moveOrdering: 'material' } } as const);
    const sorter = vi.spyOn(evaluation, 'resolveSearchMaterialValueTable');
    const result = analyzeAlphaBetaSearch(state, 2, config, () => 0, options);
    expect(analyzeAlphaBetaSearch(state, 2, config, () => 0, options)).toEqual(result);
    expect(analyzeIterativeDeepeningAlphaBetaSearch(state, 2, config, () => 0, options).selectedEvaluation).toBe(result.selectedEvaluation);
    expect(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 1000, config, () => 0, options).selectedEvaluation).toBe(result.selectedEvaluation);
    expect(analyzeTwoPlyAlphaBetaSearch(state, config, () => 0, options).selectedAction).toEqual(result.selectedAction);
    expect(selectBestAlphaBetaAction(state, 2, config, options)).toEqual(result.selectedAction);
    expect(selectBestIterativeDeepeningAlphaBetaAction(state, 2, config, options)).toEqual(result.selectedAction);
    expect(selectBestTwoPlyAlphaBetaAction(state, config, options)).toEqual(result.selectedAction);
    expect(sorter).toHaveBeenCalledWith(config);
  });
  it.each(['unknown', 'static-exchange', null, 1, true, {}, []])('rejects unsupported mode %j before clock or search', mode => {
    const clock = vi.fn(() => 0), generate = vi.spyOn(legal, 'getLegalActions');
    const options = { quiescence: { maxTacticalDepth: 1, moveOrdering: mode } } as unknown as Parameters<typeof analyzeAlphaBetaSearch>[4];
    for (const search of [analyzeAlphaBetaSearch, analyzeIterativeDeepeningAlphaBetaSearch]) {
      expect(() => search(captureBoard(), 1, undefined, clock, options)).toThrow(/quiescence move ordering/);
    }
    expect(() => analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(captureBoard(), 1, 1000, undefined, clock, options)).toThrow(/quiescence move ordering/);
    expect(() => analyzeTwoPlyAlphaBetaSearch(captureBoard(), undefined, clock, options)).toThrow(/quiescence move ordering/);
    expect(clock).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([{ extra: true }, { [Symbol('extra')]: true }])('rejects unknown quiescence keys before search', extra => {
    const clock = vi.fn(() => 0);
    expect(() => analyzeAlphaBetaSearch(captureBoard(), 1, undefined, clock, { quiescence: { maxTacticalDepth: 1, ...extra } })).toThrow(/only maxTacticalDepth/);
    expect(clock).not.toHaveBeenCalled();
  });
  it.each(positions.map(p => [p.id, p] as const))('matches fixed-depth scores and replayed leaf breakdowns: %s', (_id, p) => {
    const state = createComparisonSnapshot(p.create());
    for (const depth of [1, 2]) {
      const results = (['original', 'material'] as const).map(moveOrdering => analyzeAlphaBetaSearch(state, 1, undefined, () => 0,
        { quiescence: { maxTacticalDepth: depth, moveOrdering } }));
      expect(results[0].selectedEvaluation).toBe(results[1].selectedEvaluation);
      for (const result of results) {
        let leaf = structuredClone(state);
        expect(result.principalVariation[0]).toEqual(result.selectedAction);
        for (const action of result.principalVariation) {
          expect(getLegalActions(leaf)).toContainEqual(action);
          const execution = executeLegalAction(leaf, action);
          if (execution.type !== 'applied') throw new Error('Illegal PV');
          leaf = execution.state;
        }
        expect(evaluateSearchPositionBreakdown(leaf, state.turn)).toEqual(result.evaluationBreakdown);
      }
    }
  });
});
