// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { isPlayerInCheck } from '../domain/shogi/checkmate';
import { createPositionKey } from '../domain/shogi/repetition';
import { executeLegalAction, getLegalActions, type LegalAction } from '../domain/shogi/legalActions';
import { runPairedSelfPlayMatch, type PairedSelfPlayMatchResult } from '../domain/shogi/pairedSelfPlayMatch';
import type { SelfPlaySearchResult } from '../domain/shogi/selfPlayGame';
import { SELF_PLAY_CONFIG, type SelfPlayBenchmarkDependencies } from '../../scripts/benchmarks/quiescenceOrderingSelfPlay';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS } from '../../scripts/benchmarks/quiescenceOrderingSelfPlayScenarios';
import { positionGameSignature, runSelfPlaySuite, runSelfPlaySuiteCli, type PairRunner } from '../../scripts/benchmarks/quiescenceOrderingSelfPlaySuite';

function nullObservation(state: BoardState): SelfPlaySearchResult {
  return {
    selectedAction: getLegalActions(state)[0], selectedEvaluation: null, completedDepth: null,
    elapsedMilliseconds: null, timedOut: null, principalVariation: null, evaluationBreakdown: null,
    visitedPositionCount: null, totalVisitedPositionCount: null, cutoffCount: null, totalCutoffCount: null,
    skippedActionCount: null, totalSkippedActionCount: null, quiescenceLeafCount: null,
    totalQuiescenceLeafCount: null, quiescenceVisitedPositionCount: null,
    totalQuiescenceVisitedPositionCount: null, quiescenceCutoffCount: null,
    totalQuiescenceCutoffCount: null, quiescenceSkippedActionCount: null,
    totalQuiescenceSkippedActionCount: null,
  };
}

const shortRunner: PairRunner = options =>
  runPairedSelfPlayMatch({ ...options, maxPlies: 1 });

const fixtureSearch: NonNullable<SelfPlayBenchmarkDependencies['search']> = state =>
  nullObservation(state) as ReturnType<NonNullable<SelfPlayBenchmarkDependencies['search']>>;
const dependencies = { search: fixtureSearch, runner: shortRunner };

function observedPair(outcome: 'failed' | 'max_plies'): PairedSelfPlayMatchResult {
  const state = createInitialBoardState();
  const result = outcome === 'failed'
    ? { status: 'failed' as const, finalState: state, plies: [], failure: {
      ply: 1, player: 'sente' as const, stage: 'search' as const, code: 'search_exception' as const, message: 'fixture failure',
    } }
    : { status: 'max_plies' as const, finalState: state, plies: [] };
  return {
    games: [
      { gameNumber: 1, sente: 'A', gote: 'B', result, outcome },
      { gameNumber: 2, sente: 'B', gote: 'A', result, outcome },
    ],
    summary: { aWins: 0, bWins: 0, draws: 0, maxPlies: outcome === 'max_plies' ? 2 : 0, failures: outcome === 'failed' ? 2 : 0 },
  };
}

describe('quiescence ordering multi-position self-play suite', () => {
  it('has seven stable, unique, legal starts with independent state instances', () => {
    expect(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => scenario.id)).toEqual([
      'standard-hirate', 'rook-pawn-opening-76-34-26-84', 'rook-pawn-exchange-26-84-25-85',
      'quiet-double-static-rook-middlegame', 'rook-pawn-recapture-middlegame',
      'check-evasion-endgame', 'hand-drop-endgame',
    ]);
    expect(new Set(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => scenario.id)).size)
      .toBe(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length);
    const states = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => scenario.create());
    expect(states.map(state => state.turn)).toEqual(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => scenario.sideToMove));
    expect(new Set(states.map(state => state.turn))).toEqual(new Set(['sente', 'gote']));
    expect(states.map(state => state.history.length)).toEqual([0, 4, 4, 20, 10, 0, 0]);
    expect(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => scenario.phase))
      .toEqual(['opening', 'opening', 'opening', 'middlegame', 'middlegame', 'endgame', 'endgame']);
    expect(states.every(state => state.status === 'active' || state.status === 'check')).toBe(true);
    expect(states.every(state => getLegalActions(state).length > 0)).toBe(true);
    const positionKeys = states.map(state => createPositionKey(state));
    expect(new Set(positionKeys).size).toBe(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length);
    expect(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => createPositionKey(scenario.create())))
      .toEqual(positionKeys);
    expect(states[1].squares[5][2].piece?.player).toBe('sente'); // ▲7六歩
    expect(states[1].squares[3][6].piece?.player).toBe('gote'); // △3四歩
    expect(states[2].squares[4][7].piece?.player).toBe('sente'); // ▲2五歩
    expect(states[2].squares[4][1].piece?.player).toBe('gote'); // △8五歩
    const first = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[1].create();
    const second = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS[1].create();
    first.squares[5][2].piece = null;
    expect(second.squares[5][2].piece).not.toBeNull();
  });

  it('fixes each middle- and endgame scenario to its stated board characteristics', () => {
    const scenario = (id: string) => {
      const found = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.find(candidate => candidate.id === id);
      if (!found) throw new Error(`Missing fixture scenario ${id}`);
      return found;
    };
    const boardPieceCount = (state: BoardState) => state.squares.flat().filter(square => square.piece !== null).length;

    const quiet = scenario('quiet-double-static-rook-middlegame').create();
    expect(quiet.status).toBe('active');
    expect(quiet.history).toHaveLength(20);
    expect(quiet.squares[7][5].piece).toMatchObject({ player: 'sente', type: 'king' });
    expect(quiet.squares[1][3].piece).toMatchObject({ player: 'gote', type: 'king' });
    expect(quiet.squares[7][6].piece).toMatchObject({ player: 'sente', type: 'silver' });
    expect(quiet.squares[1][5].piece).toMatchObject({ player: 'gote', type: 'silver' });

    const recapture = scenario('rook-pawn-recapture-middlegame').create();
    expect(recapture.status).toBe('active');
    expect(recapture.squares[3][7].piece).toMatchObject({ player: 'sente', type: 'rook' });
    expect(recapture.squares[5][1].piece).toMatchObject({ player: 'gote', type: 'rook' });
    expect(recapture.senteHand.filter(piece => piece.type === 'pawn')).toHaveLength(2);
    expect(recapture.goteHand.filter(piece => piece.type === 'pawn')).toHaveLength(2);

    const check = scenario('check-evasion-endgame').create();
    expect(check.turn).toBe('gote');
    expect(check.status).toBe('check');
    expect(boardPieceCount(check)).toBe(8);
    expect(check.squares[4][4].piece).toMatchObject({ player: 'sente', type: 'rook' });
    expect(check.goteHand.map(piece => piece.type)).toEqual(['pawn', 'gold']);
    const evasions = getLegalActions(check);
    expect(evasions.length).toBeGreaterThan(0);
    const evasion = executeLegalAction(check, evasions[0], { proposer: 'local_ai' });
    expect(evasion.type).toBe('applied');
    if (evasion.type === 'applied') expect(isPlayerInCheck(evasion.state, 'gote')).toBe(false);

    const handDrop = scenario('hand-drop-endgame').create();
    expect(handDrop.turn).toBe('gote');
    expect(handDrop.status).toBe('active');
    expect(boardPieceCount(handDrop)).toBe(7);
    expect(handDrop.goteHand.map(piece => piece.type)).toEqual(['pawn', 'gold']);
    const pawnDrop = getLegalActions(handDrop).find((action): action is Extract<LegalAction, { kind: 'drop' }> =>
      action.kind === 'drop' && action.player === 'gote' && action.pieceType === 'pawn');
    expect(pawnDrop).toBeDefined();
    const appliedPawnDrop = executeLegalAction(handDrop, pawnDrop!, { proposer: 'local_ai' });
    expect(appliedPawnDrop.type).toBe('applied');
    if (appliedPawnDrop.type === 'applied') {
      expect(appliedPawnDrop.state.squares[pawnDrop!.to.row][pawnDrop!.to.col].piece)
        .toMatchObject({ player: 'gote', type: 'pawn' });
      expect(isPlayerInCheck(appliedPawnDrop.state, 'gote')).toBe(false);
    }
  });

  it('runs exactly one seat-swapped pair for every scenario in catalog order and preserves null observations', () => {
    const inputs: string[] = [];
    const runner = vi.fn((options: Parameters<PairRunner>[0]) => {
      inputs.push(createPositionKey(options.initialState));
      return shortRunner(options);
    });
    const result = runSelfPlaySuite({ ...dependencies, runner });
    expect(runner).toHaveBeenCalledTimes(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length);
    expect(inputs).toEqual(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => createPositionKey(scenario.create())));
    expect(result.scenarios.map(scenario => scenario.executionOrder)).toEqual(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map((_, index) => index + 1));
    expect(result.scenarios.every(scenario => scenario.pair.games.length === 2)).toBe(true);
    expect(result.scenarios.map(scenario => scenario.summary.outcomes.maxPlies)).toEqual(Array(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length).fill(2n));
    expect(result.summary).toMatchObject({ totalGames: BigInt(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2), outcomeCountSum: BigInt(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2), consistent: true,
      outcomes: { aWins: 0n, bWins: 0n, draws: 0n, maxPlies: BigInt(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2), failures: 0n },
    });
    expect(result.scenarios[0].games[0].participants.A.elapsedMilliseconds).toBeNull();
  });

  it('keeps failed and max-ply games as counted observations', () => {
    let call = 0;
    const result = runSelfPlaySuite({ runner: () => observedPair(++call === 1 ? 'failed' : 'max_plies') });
    expect(result.summary.outcomes).toEqual({ aWins: 0n, bWins: 0n, draws: 0n, maxPlies: BigInt((QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length - 1) * 2), failures: 2n });
    expect(result.summary.totalGames).toBe(BigInt(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2));
  });

  it('distinguishes different starts with the same moves and counts an exact repeat as a duplicate', () => {
    const action = getLegalActions(createInitialBoardState())[0] as LegalAction;
    const [first, second] = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(scenario => createPositionKey(scenario.create()));
    expect(positionGameSignature(first, [action])).not.toBe(positionGameSignature(second, [action]));
    expect(positionGameSignature(first, [action])).toBe(positionGameSignature(first, [action]));
  });

  it('labels runner exceptions with the scenario and emits no incomplete suite summary', () => {
    let calls = 0;
    expect(() => runSelfPlaySuite({ ...dependencies, runner: options => {
      if (++calls === 2) throw new Error('runner fixture exception');
      return shortRunner(options);
    } })).toThrow('scenario=rook-pawn-opening-76-34-26-84: runner fixture exception');
    const lines: string[] = [];
    expect(runSelfPlaySuiteCli({ ...dependencies, runner: () => { throw new Error('runner fixture exception'); } }, line => lines.push(line))).toBe(1);
    expect(lines.some(line => line.startsWith('SCENARIO_START '))).toBe(true);
    expect(lines.some(line => line.startsWith('ERROR ') && line.includes('standard-hirate'))).toBe(true);
    expect(lines.some(line => line.startsWith('SUITE_SUMMARY '))).toBe(false);
  });

  it('writes scenario progress, every result category, and a complete summary through the CLI boundary', () => {
    const lines: string[] = [];
    expect(runSelfPlaySuiteCli(dependencies, line => lines.push(line))).toBe(0);
    const read = (prefix: string) => lines.filter(line => line.startsWith(`${prefix} `)).map(line => JSON.parse(line.slice(prefix.length + 1)));
    expect(read('SUITE_CONFIG')[0]).toMatchObject({ scenarioIds: QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.map(s => s.id),
      pairsPerScenario: 1, maxPlies: SELF_PLAY_CONFIG.maxPlies });
    expect(read('SCENARIO_START')).toHaveLength(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length); expect(read('RECORD')).toHaveLength(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2);
    expect(read('GAME')).toHaveLength(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2); expect(read('SCENARIO_SUMMARY')).toHaveLength(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length);
    expect(read('SUITE_SUMMARY')[0]).toMatchObject({ totalGames: String(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2), outcomeCountSum: String(QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.length * 2), consistent: true });
  });
});
