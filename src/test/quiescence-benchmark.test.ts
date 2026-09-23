// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { QUIESCENCE_BENCHMARK_POSITIONS as positions, type BenchmarkPosition } from '../../scripts/benchmarks/quiescencePositions';
import { formatBenchmarkCase, formatBenchmarkSummary, parseBenchmarkModes, runBenchmarkCase, runBenchmarkSuite,
  summarizeBenchmark, type BenchmarkCase, type BenchmarkMode } from '../../scripts/benchmarks/quiescenceSuite';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, executeLegalAction,
  getLegalActions, isPlayerInCheck, type LegalAction } from '../domain/shogi';
import { createPositionKey } from '../domain/shogi/repetition';
import { createComparisonSnapshot } from '../domain/shogi/evaluationPresetComparison';
import { createInitialBoardState, type BoardState, type Player } from '../types/shogi';

const position = (id: string) => positions.find(p => p.id === id)!;
function applied(state: BoardState, action: LegalAction): BoardState {
  const result = executeLegalAction(state, action);
  if (result.type !== 'applied') throw new Error('Expected a legal fixture action');
  return result.state;
}
function ended(winner: Player | null = 'sente'): BoardState {
  return { ...createInitialBoardState(), status: 'ended', result: winner === null
    ? { winner: null, loser: null, endReason: 'repetition' }
    : { winner, loser: winner === 'sente' ? 'gote' : 'sente', endReason: 'resignation' } };
}
const terminal: BenchmarkPosition = { ...position('initial'), id: 'terminal-test', create: () => ended() };
const zeroClock = () => 0;

describe('ベンチマークの局面定義', () => {
  it('安定した一意IDと6種類の目的・日本語名・由来を持ち、毎回独立した同じ局面を生成する', () => {
    expect(new Set(positions.map(p => p.id)).size).toBe(positions.length);
    expect(positions.map(p => p.purpose)).toEqual(['quiet', 'recapture', 'poisoned-capture', 'check-evasion', 'promotion-capture', 'drop-evasion']);
    for (const p of positions) {
      expect(p.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(p.name).toMatch(/[一-龠ぁ-んァ-ヶ]/);
      expect(p.observation.length).toBeGreaterThan(0);
      expect(p.provenance.length).toBeGreaterThan(0);
      expect(p.create()).toEqual(p.create());
      expect(p.create().squares).not.toBe(p.create().squares);
    }
  });

  it.each(positions.map(p => [p.id, p] as const))('%s: 玉・二歩・行き所・駒数・手番・王手・履歴が整合し、列挙した全合法手を実行できる', (_, p) => {
    const state = p.create();
    const before = structuredClone(state);
    const pieces = state.squares.flatMap(row => row.flatMap(s => s.piece ? [s.piece] : []));
    const allPieces = [...pieces, ...state.senteHand, ...state.goteHand];
    expect(new Set(allPieces.map(piece => piece.id)).size).toBe(allPieces.length);
    for (const player of ['sente', 'gote'] as const) {
      expect(pieces.filter(piece => piece.player === player && piece.type === 'king')).toHaveLength(1);
      for (let col = 0; col < 9; col++) {
        expect(state.squares.filter(row => row[col].piece?.player === player && row[col].piece?.type === 'pawn' && !row[col].piece?.isPromoted).length).toBeLessThanOrEqual(1);
      }
      const hand = player === 'sente' ? state.senteHand : state.goteHand;
      expect(hand.every(piece => piece.player === player && piece.type !== 'king' && !piece.isPromoted)).toBe(true);
    }
    for (const row of state.squares) for (const { piece, rank } of row) {
      if (!piece || piece.isPromoted) continue;
      const distance = piece.player === 'sente' ? rank - 1 : 9 - rank;
      if (piece.type === 'pawn' || piece.type === 'lance') expect(distance).toBeGreaterThan(0);
      if (piece.type === 'knight') expect(distance).toBeGreaterThan(1);
    }
    for (const [type, maximum] of Object.entries({ king: 2, rook: 2, bishop: 2, gold: 4, silver: 4, knight: 4, lance: 4, pawn: 18 })) {
      expect(allPieces.filter(piece => piece.type === type).length).toBeLessThanOrEqual(maximum);
    }
    expect(state.turn).toBe('sente');
    const check = p.purpose === 'check-evasion' || p.purpose === 'drop-evasion';
    expect(isPlayerInCheck(state, 'sente')).toBe(check);
    expect(isPlayerInCheck(state, 'gote')).toBe(false);
    expect(state.status).toBe(check ? 'check' : 'active');
    expect(state.history).toEqual([]);
    expect(state.moveNumber).toBe(1);
    expect(state.positionHistory).toEqual([{ key: createPositionKey(state), historyIndex: 0, movedBy: null, gaveCheck: false }]);
    expect(state.positionSnapshots).toHaveLength(1);
    expect(createPositionKey(state.positionSnapshots![0])).toBe(createPositionKey(state));
    expect(state.positionSnapshots![0].status).toBe(state.status);
    const actions = getLegalActions(state);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(isPlayerInCheck(applied(state, action), 'sente')).toBe(false);
    expect(state).toEqual(before);
  });

  it.each(['pawn-recapture', 'poisoned-rook'])('%s: 捕獲の直後に銀による取り返しが合法である', id => {
    const state = position(id).create();
    const capture = getLegalActions(state).find(a => a.kind === 'move' && a.from.row === 5 && a.from.col === 4 && a.to.row === 4 && a.to.col === 4)!;
    expect(capture).toBeDefined();
    const next = applied(state, capture);
    expect(next.senteHand).toHaveLength(1);
    const recapture = getLegalActions(next).find(a => a.kind === 'move' && a.from.row === 3 && a.from.col === 4 && a.to.row === 4 && a.to.col === 4)!;
    expect(recapture).toBeDefined();
    expect(applied(next, recapture).goteHand[0].type).toBe(id === 'poisoned-rook' ? 'rook' : 'pawn');
  });

  it('静かな初期局面・成り捕獲・玉移動・金の合駒の目的が実際の合法手と一致する', () => {
    const initial = position('initial').create();
    expect(getLegalActions(initial).every(a => a.kind === 'move' && initial.squares[a.to.row][a.to.col].piece === null)).toBe(true);
    const promotion = position('promotion-capture').create();
    const capture = getLegalActions(promotion).find(a => a.kind === 'move' && a.promotion === 'promote' && a.to.row === 2 && a.to.col === 4)!;
    expect(applied(promotion, capture).squares[2][4].piece?.isPromoted).toBe(true);
    expect(getLegalActions(position('rook-check').create()).some(a => a.kind === 'move' && a.pieceType === 'king')).toBe(true);
    const dropState = position('gold-drop-evasion').create();
    const drops = getLegalActions(dropState).filter(a => a.kind === 'drop');
    expect(drops.length).toBeGreaterThan(0);
    for (const action of drops) {
      expect(action.pieceType).toBe('gold');
      expect(isPlayerInCheck(applied(dropState, action), 'sente')).toBe(false);
    }
  });
});

describe('比較APIを使用するrunner', () => {
  it.each(['fixed', 'timed'] as const)('%s: 固定順・独立スナップショット・既定評価・標準順・無効時省略・固定引数を守る', mode => {
    const input = terminal.create();
    const before = structuredClone(input);
    const fixedSearch = vi.fn(analyzeAlphaBetaSearch);
    const timedSearch = vi.fn(analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch);
    const entry = runBenchmarkCase({ ...terminal, create: () => input }, mode, { clock: zeroClock, fixedSearch, timedSearch });
    expect(entry.ok).toBe(true);
    const calls = mode === 'fixed' ? fixedSearch.mock.calls : timedSearch.mock.calls;
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map(c => c[0])).size).toBe(3);
    for (const collection of ['squares', 'senteHand', 'goteHand', 'history', 'positionHistory', 'positionSnapshots'] as const) {
      expect(new Set(calls.map(c => c[0][collection])).size).toBe(3);
      expect(calls[0][0][collection]).not.toBe(input[collection]);
      expect(Object.isFrozen(calls[0][0][collection])).toBe(true);
    }
    for (const [i, call] of calls.entries()) {
      expect(call[0]).toEqual(createComparisonSnapshot(input));
      expect(call[1]).toBe(mode === 'fixed' ? 3 : 4);
      const offset = mode === 'fixed' ? 0 : 1;
      if (mode === 'timed') expect(call[2]).toBe(1000);
      expect(call[2 + offset]).toBeUndefined();
      expect(call[3 + offset]).toBe(zeroClock);
      expect(call[4 + offset]).toEqual(i === 0 ? { moveOrdering: 'standard' } : { moveOrdering: 'standard', quiescence: { maxTacticalDepth: i } });
      if (i === 0) expect(call[4 + offset]).not.toHaveProperty('quiescence');
    }
    expect(input).toEqual(before);
  });

  it('固定深さの実探索は時間以外の全結果を再現し、入力を変更しない', () => {
    const state = position('promotion-capture').create();
    const before = structuredClone(state);
    const p = { ...position('promotion-capture'), create: () => state };
    const first = runBenchmarkCase(p, 'fixed', { clock: zeroClock });
    const second = runBenchmarkCase(p, 'fixed', { clock: zeroClock });
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(state).toEqual(before);
    expect(formatBenchmarkCase(first)).toContain('通常探索深さ=3');
  });

  it('偽時計で各設定の独立予算を検証し、実時間を待たない', () => {
    let now = 0;
    const starts: number[] = [];
    const timedSearch: typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch = (...args) => {
      starts.push(now);
      return analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(...args);
    };
    const entry = runBenchmarkCase(position('rook-check'), 'timed', { clock: () => { const value = now; now += 600; return value; }, timedSearch });
    expect(entry.ok).toBe(true);
    expect(starts).toHaveLength(3);
    expect(starts[1]).toBeGreaterThan(starts[0]);
    expect(starts[2]).toBeGreaterThan(starts[1]);
    if (!entry.ok) throw new Error(entry.error);
    expect(entry.results.every(r => 'completedDepth' in r && r.completedDepth === 0 &&
      r.resultSource === 'fallback' && r.timedOut)).toBe(true);
    expect(formatBenchmarkCase(entry)).toContain('全完了反復合計');
    expect(summarizeBenchmark([entry], 'timed')).toMatchObject({ errorCount: 0, maxDepthUnreachedCount: 1 });
  });

  it('持ち駒・棋譜・局面履歴のある入力を両モードで保持する', () => {
    const initial = position('pawn-recapture').create();
    const capture = getLegalActions(initial).find(a => a.kind === 'move' && a.to.row === 4 && a.to.col === 4)!;
    const state = applied(initial, capture);
    const before = structuredClone(state);
    expect(state.history).toHaveLength(1);
    expect(state.senteHand).toHaveLength(1);
    expect(state.positionHistory).toHaveLength(2);
    let now = 0;
    const cases = runBenchmarkSuite(['fixed', 'timed'], { clock: () => now += 600 }, [{ ...terminal, create: () => state }]);
    expect(cases.every(c => c.ok)).toBe(true);
    expect(state).toEqual(before);
  });

  it.each((['fixed', 'timed'] as const).flatMap(mode => [0, 1, 2].map(index => [mode, index] as const)))('%s: 第%i設定の探索失敗を局面ID・設定・モード付きで報告する', (mode, index) => {
    let count = 0;
    const fail = () => { if (count++ === index) throw new Error('injected failure'); };
    const fixedSearch: typeof analyzeAlphaBetaSearch = (...args) => { fail(); return analyzeAlphaBetaSearch(...args); };
    const timedSearch: typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch = (...args) => { fail(); return analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(...args); };
    const entry = runBenchmarkCase(terminal, mode, { clock: zeroClock, fixedSearch, timedSearch });
    expect(entry).toMatchObject({ ok: false, error: expect.stringContaining(`position=terminal-test mode=${mode} setting=${index || 'disabled'}`) });
    expect(count).toBe(index + 1);
    expect(entry).not.toHaveProperty('results');
    expect(formatBenchmarkCase(entry)).toContain('ERROR');
  });

  it.each(['fixed', 'timed'] as const)('%s: 不正な結果を既存validatorで拒否し、設定も特定する', mode => {
    const entry = runBenchmarkCase(terminal, mode, {
      clock: zeroClock,
      fixedSearch: (...args) => ({ ...analyzeAlphaBetaSearch(...args), elapsedMilliseconds: args[4]?.quiescence?.maxTacticalDepth === 1 ? NaN : 0 }),
      timedSearch: (...args) => ({ ...analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(...args), elapsedMilliseconds: args[5]?.quiescence?.maxTacticalDepth === 1 ? NaN : 0 }),
    });
    expect(entry.ok).toBe(false);
    if (entry.ok) throw new Error('Unexpected success');
    expect(entry.error).toContain(`position=terminal-test mode=${mode}`);
    expect(entry.error).toContain('setting=1');
  });

  it('スナップショットへの変更を失敗扱いにし、元入力も監視する', () => {
    const state = terminal.create();
    const before = structuredClone(state);
    const p = { ...terminal, create: () => state };
    const snapshotMutation = runBenchmarkCase(p, 'fixed', { fixedSearch: snapshot => { snapshot.senteHand.push({ id: 'illegal', type: 'gold', player: 'sente' }); throw new Error('unreachable'); } });
    expect(snapshotMutation.ok).toBe(false);
    expect(state).toEqual(before);
    const inputMutation = runBenchmarkCase(p, 'fixed', { clock: zeroClock, fixedSearch: (...args) => { state.turn = 'gote'; return analyzeAlphaBetaSearch(...args); } });
    expect(inputMutation).toMatchObject({ ok: false, error: expect.stringContaining('入力局面が変更されました') });
  });

  it('一局面の失敗後も続行し、重複IDは探索前に拒否する', () => {
    const broken = { ...terminal, id: 'broken', create: (): BoardState => { throw new Error('bad fixture'); } };
    const onCase = vi.fn();
    const cases = runBenchmarkSuite(['fixed'], { clock: zeroClock }, [broken, terminal], onCase);
    expect(cases.map(c => c.ok)).toEqual([false, true]);
    expect(onCase).toHaveBeenCalledTimes(2);
    expect(() => runBenchmarkSuite(['fixed'], {}, [terminal, terminal])).toThrow('局面IDが重複');
    expect(summarizeBenchmark(cases, 'fixed')).toMatchObject({ successCount: 1, errorCount: 1, changedOne: 0, changedTwo: 0 });
  });
});

describe('出力と客観的な集計', () => {
  it.each([['sente', '+∞'], ['gote', '-∞'], [null, '0']] as const)('終局 %s の評価・手なし・空PVを安全に表示する', (winner, score) => {
    const entry = runBenchmarkCase({ ...terminal, create: () => ended(winner) }, 'fixed', { clock: zeroClock });
    expect(entry.ok).toBe(true);
    const output = formatBenchmarkCase(entry);
    expect(output).toContain(`先手評価=${score}`);
    expect(output).toContain('推奨手=手なし');
    expect(output).toContain('PV=手順なし');
    expect(output).not.toContain('NaN');
  });

  it('後手視点を先手へ反転し、不正なNaN評価は成功にしない', () => {
    const gote = runBenchmarkCase({ ...terminal, create: () => ({ ...ended('gote'), turn: 'gote' }) }, 'fixed', { clock: zeroClock });
    expect(formatBenchmarkCase(gote)).toContain('先手評価=-∞');
    const invalid = runBenchmarkCase(terminal, 'fixed', { clock: zeroClock, fixedSearch: (...args) => {
      const r = analyzeAlphaBetaSearch(...args); return { ...r, evaluationBreakdown: { ...r.evaluationBreakdown, total: NaN } };
    } });
    expect(invalid.ok).toBe(false);
  });

  it('推奨手の構造的比較・null・失敗除外と各設定の探索量を正しく集計する', () => {
    const base = runBenchmarkCase(terminal, 'fixed', { clock: zeroClock });
    if (!base.ok) throw new Error(base.error);
    const actions = getLegalActions(createInitialBoardState());
    const make = (id: string, choices: (LegalAction | null)[]): BenchmarkCase => ({ ...base, position: { ...terminal, id }, results: base.results.map((r, i) => ({ ...r, selectedAction: choices[i], visitedPositionCount: i + 1 })) });
    const cases = [make('same', [actions[0], structuredClone(actions[0]), actions[0]]),
      make('one', [actions[0], actions[1], actions[0]]), make('two', [actions[0], actions[0], actions[1]]),
      make('none', [null, null, null]), make('null-change', [null, actions[0], actions[0]]),
      { position: terminal, mode: 'fixed' as BenchmarkMode, ok: false as const, error: 'test failure' }];
    const summary = summarizeBenchmark(cases, 'fixed');
    expect(summary).toMatchObject({ positionCount: 6, successCount: 5, errorCount: 1, changedOne: 2, changedTwo: 2 });
    expect(summary.settings.map(s => s.totals[0])).toEqual([5, 10, 15]);
    expect(summary.settings.every(s => s.depths.length === 5)).toBe(true);
    expect(formatBenchmarkSummary(cases, 'fixed')).toContain('なし→追加1手=2/5局面');
    expect(summarizeBenchmark(cases, 'timed').successCount).toBe(0);
  });

  it.each([[[], ['fixed', 'timed']], [['fixed'], ['fixed']], [['timed'], ['timed']], [['both'], ['fixed', 'timed']]])('最小CLI %j', (args, expected) => {
    expect(parseBenchmarkModes(args)).toEqual(expected);
  });
  it('同一時間の集計で最深反復と全完了反復の通常・静止統計を混同しない', () => {
    const base = runBenchmarkCase(terminal, 'timed', { clock: zeroClock });
    if (!base.ok) throw new Error(base.error);
    // Synthetic statistics exercise aggregation only, not search performance.
    const sample: BenchmarkCase = { ...base, results: base.results.map(r => ({ ...r,
      visitedPositionCount: 3, cutoffCount: 2, skippedActionCount: 1,
      quiescenceLeafCount: 2, quiescenceVisitedPositionCount: 5, quiescenceCutoffCount: 1, quiescenceSkippedActionCount: 4,
      totalVisitedPositionCount: 30, totalCutoffCount: 20, totalSkippedActionCount: 10,
      totalQuiescenceLeafCount: 20, totalQuiescenceVisitedPositionCount: 50, totalQuiescenceCutoffCount: 10, totalQuiescenceSkippedActionCount: 40,
    })) };
    const summary = summarizeBenchmark([sample, sample], 'timed');
    expect(summary.settings[1].deepest).toEqual([6, 4, 2, 4, 10, 2, 8]);
    expect(summary.settings[1].totals).toEqual([60, 40, 20, 40, 100, 20, 80]);
    expect(formatBenchmarkSummary([sample], 'timed')).toContain('全完了反復の局面合計: 通常[訪問=30');
  });
  it.each([['unknown'], ['fixed', 'timed'], ['--time=1']])('未知CLI %j を拒否する', (...args) => {
    expect(() => parseBenchmarkModes(args)).toThrow('Usage');
  });
});
