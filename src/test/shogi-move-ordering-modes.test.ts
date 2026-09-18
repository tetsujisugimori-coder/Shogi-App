import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../types/shogi';
import * as search from '../domain/shogi/twoPlyAlphaBetaAi';
import * as see from '../domain/shogi/staticExchangeEvaluation';
import * as legal from '../domain/shogi/legalActions';
import * as material from '../domain/shogi/materialEvaluation';
import * as evaluation from '../domain/shogi/twoPlyMinimaxAi';
import * as replay from '../domain/shogi/replay';
import { SEARCH_EVALUATION_PRESET_IDS, resolveSearchEvaluationPreset } from '../domain/shogi/searchEvaluationPresets';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest as handleWorker } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import { ORDERING_BASELINES } from './fixtures/alpha-beta-ordering-baselines';

type Placement = [number, number, PieceType, Player];
function position(pieces: Placement[]): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  const kings: Placement[] = [[8, 8, 'king', 'sente'], [0, 8, 'king', 'gote']];
  for (const [row, col, type, player] of [...kings, ...pieces]) {
    state.squares[row][col].piece = { id: `${player}-${type}-${row}-${col}`, type, player };
  }
  return state;
}

function nonRootCaptures(): BoardState {
  return position([[1, 2, 'pawn', 'sente'], [0, 2, 'silver', 'gote'],
    [4, 4, 'rook', 'sente'], [4, 5, 'rook', 'gote'], [2, 0, 'pawn', 'sente']]);
}

const fixtures = {
  initial: createInitialBoardState,
  moveOrderingBenefitState: () => position([[4, 4, 'rook', 'sente'],
    [3, 4, 'pawn', 'gote'], [4, 5, 'silver', 'gote'], [4, 6, 'rook', 'gote'], [5, 4, 'pawn', 'sente']]),
  singleCapture: () => position([[4, 4, 'rook', 'sente'], [4, 5, 'pawn', 'gote']]),
  multipleCaptures: () => position([[4, 4, 'rook', 'sente'], [4, 5, 'pawn', 'gote'], [3, 4, 'silver', 'gote']]),
  nonRootMultipleCaptures: nonRootCaptures,
};
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
const clock = () => 0;
const modes = ['standard', 'static-exchange'] as const;
afterEach(() => vi.restoreAllMocks());

describe('alpha-beta move-ordering modes', () => {
  it('defaults to exact main classification and original indexes without any SEE preparation work', () => {
    const state = nonRootCaptures();
    state.senteHand.push({ id: 'hand', type: 'gold', player: 'sente' });
    const actions = legal.getLegalActions(state);
    const isCapture = (a: legal.LegalAction) => a.kind === 'move' && state.squares[a.to.row][a.to.col].piece !== null;
    const capturePromotions = actions.filter(a => isCapture(a) && a.promotion === 'promote');
    const captures = actions.filter(a => isCapture(a) && a.promotion !== 'promote');
    const promotions = actions.filter(a => !isCapture(a) && a.promotion === 'promote');
    const others = actions.filter(a => !isCapture(a) && a.promotion !== 'promote');
    for (const group of [capturePromotions, captures, promotions, others]) expect(group.length).toBeGreaterThan(0);
    expect(others.some(a => a.kind === 'drop')).toBe(true);
    const source = [...others, ...promotions, ...captures, ...capturePromotions];
    const expected = [...capturePromotions, ...captures, ...promotions, ...others];
    const table = structuredClone(material.DEFAULT_MATERIAL_VALUE_TABLE);
    const snapshot = structuredClone({ state, source, table });
    freezeDeep(state); freezeDeep(source); freezeDeep(table);
    const spies = [vi.spyOn(see, 'prepareStaticExchangeEvaluation'), vi.spyOn(see, 'evaluateStaticExchange'),
      vi.spyOn(evaluation, 'resolveSearchMaterialValueTable'), vi.spyOn(replay, 'cloneBoardState'),
      vi.spyOn(legal, 'getLegalActions'), vi.spyOn(material, 'evaluateMaterial')];
    for (const options of [undefined, {}, Object.freeze({ moveOrdering: 'standard' } as const)]) {
      expect(search.orderAlphaBetaNodeActions(state, source, table, undefined, options)).toEqual(expected);
      expect(search.orderAlphaBetaNodeActions(state, [...source].reverse(), table, undefined, options))
        .toEqual([...[...capturePromotions].reverse(), ...[...captures].reverse(),
          ...[...promotions].reverse(), ...[...others].reverse()]);
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect({ state, source, table }).toEqual(snapshot);
  });

  const entries: [string, (state: BoardState, options?: search.AlphaBetaSearchOptions) => legal.LegalAction | null][] = [
    ['fixed', (s, o) => search.analyzeAlphaBetaSearch(s, 2, undefined, clock, o).selectedAction],
    ['iterative', (s, o) => search.analyzeIterativeDeepeningAlphaBetaSearch(s, 2, undefined, clock, o).selectedAction],
    ['timed', (s, o) => search.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s, 2, 1000, undefined, clock, o).selectedAction],
    ['select fixed', (s, o) => search.selectBestAlphaBetaAction(s, 2, undefined, o)],
    ['select iterative', (s, o) => search.selectBestIterativeDeepeningAlphaBetaAction(s, 2, undefined, o)],
    ['two ply', (s, o) => search.analyzeTwoPlyAlphaBetaSearch(s, undefined, clock, o).selectedAction],
    ['select two ply', (s, o) => search.selectBestTwoPlyAlphaBetaAction(s, undefined, o)],
  ];

  it.each(entries)('%s preserves existing calls and propagates explicit SEE through every search entry', (_name, run) => {
    const state = freezeDeep(nonRootCaptures());
    const options = freezeDeep({ moveOrdering: 'static-exchange' } as const);
    const snapshot = structuredClone({ state, options });
    const prepared = vi.spyOn(see, 'prepareStaticExchangeEvaluation');
    const publicSee = vi.spyOn(see, 'evaluateStaticExchange');
    const standard = run(state);
    expect(run(state, {})).toEqual(standard);
    expect(run(state, { moveOrdering: 'standard' })).toEqual(standard);
    expect(prepared).not.toHaveBeenCalled();
    expect(publicSee).not.toHaveBeenCalled();
    expect(run(state, options)).toEqual(standard);
    expect(prepared).toHaveBeenCalled();
    expect({ state, options }).toEqual(snapshot);
  });

  it.each([...entries,
    ['node order', (s: BoardState, o?: search.AlphaBetaSearchOptions) => search.orderAlphaBetaNodeActions(s, [], undefined, undefined, o)],
    ['root order', (s: BoardState, o?: search.AlphaBetaSearchOptions) => search.orderIterativeDeepeningRootActions(s, [], null, undefined, undefined, o)],
  ])('%s rejects unknown modes even when no ordering is needed', (_name, run) => {
    const state = nonRootCaptures();
    state.status = 'ended';
    for (const moveOrdering of ['automatic', '', null, 0]) {
      const options = { moveOrdering } as unknown as search.AlphaBetaSearchOptions;
      expect(() => run(state, options)).toThrow(/Unsupported alpha-beta move ordering mode/);
    }
  });

  describe.each(modes)('%s', (moveOrdering) => {
    it.each(ORDERING_BASELINES)('preserves recorded depth-three result for $name, frozen inputs and determinism', (baseline) => {
      const state = freezeDeep(fixtures[baseline.name]());
      const options = freezeDeep({ moveOrdering });
      const table = freezeDeep(structuredClone(material.DEFAULT_MATERIAL_VALUE_TABLE));
      const before = structuredClone({ state, options, table });
      const expected = moveOrdering === 'standard' ? baseline.standard : baseline.staticExchange;
      expect(search.analyzeAlphaBetaSearch(state, 3, table, clock, options)).toEqual(expected);
      expect(search.analyzeAlphaBetaSearch(state, 3, table, clock, options)).toEqual(expected);
      expect({ state, options, table }).toEqual(before);
    });

    it('keeps fixed root order, original root tie-breaking and previous best first', () => {
      const state = nonRootCaptures();
      const actions = legal.getLegalActions(state);
      const options = freezeDeep({ moveOrdering });
      const previous = actions.at(-1)!;
      expect(search.orderIterativeDeepeningRootActions(state, actions, null, undefined, undefined, options)).toEqual(actions);
      expect(search.orderIterativeDeepeningRootActions(state, actions, previous, undefined, undefined, options))
        .toEqual([previous, ...search.orderAlphaBetaNodeActions(state, actions.slice(0, -1), undefined, undefined, options)]);
      const table = {
        unpromoted: { pawn: 0, lance: 0, knight: 0, silver: 0, gold: 0, bishop: 0, rook: 0, king: 0 },
        promoted: { pawn: 0, lance: 0, knight: 0, silver: 0, bishop: 0, rook: 0 },
      };
      expect(search.analyzeAlphaBetaSearch(state, 1, { materialValueTable: table,
        coefficients: { material: 1, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0 } }, clock, options).selectedAction).toEqual(actions[0]);
    });

    it('preserves zero-time fallback and discards an interrupted deeper iteration', () => {
      const state = nonRootCaptures();
      const options = { moveOrdering };
      const depthOne = search.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 1, 0, undefined, clock, options);
      const fallback = search.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 6, 0, undefined, clock, options);
      expect(fallback).toEqual({ ...depthOne, requestedMaxDepth: 6, timedOut: true });
      let now = 0;
      const execute = legal.executeLegalAction;
      let count = 0;
      vi.spyOn(legal, 'executeLegalAction').mockImplementation((...args) => {
        const result = execute(...args);
        if (++count > depthOne.visitedPositionCount) now = 10;
        return result;
      });
      const interrupted = search.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 3, 10, undefined, () => now, options);
      expect(interrupted).toEqual({ ...depthOne, requestedMaxDepth: 3, timedOut: true, elapsedMilliseconds: 10 });
    });
  });

  it.each(SEARCH_EVALUATION_PRESET_IDS)('Worker remains default standard for %s without a protocol option', (presetId) => {
    const state = freezeDeep(nonRootCaptures());
    const prepared = vi.spyOn(see, 'prepareStaticExchangeEvaluation');
    const publicSee = vi.spyOn(see, 'evaluateStaticExchange');
    const run = vi.fn((input: BoardState, depth: number, limit: number, config?: evaluation.SearchEvaluationConfig) =>
      search.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input, depth, limit, config, clock));
    const result = handleWorker({ type: 'run-time-limited-iterative-deepening-alpha-beta-search',
      requestId: 'standard', state, maxDepth: 2, timeLimitMilliseconds: 1000, evaluationPresetId: presetId }, run);
    expect(run).toHaveBeenCalledWith(state, 2, 1000, resolveSearchEvaluationPreset(presetId));
    expect(result).toEqual({ type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded', requestId: 'standard',
      result: { ...search.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 1000,
        resolveSearchEvaluationPreset(presetId), clock, { moveOrdering: 'standard' }), evaluationPresetId: presetId } });
    expect(prepared).not.toHaveBeenCalled();
    expect(publicSee).not.toHaveBeenCalled();
  });
});
