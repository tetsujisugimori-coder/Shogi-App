import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInitialBoardState, type BoardState, type Player } from '../../src/types/shogi';
import type { LegalAction } from '../../src/domain/shogi/legalActions';
import type { PairedSelfPlayOutcome, PairedSelfPlayParticipantId } from '../../src/domain/shogi/pairedSelfPlayMatch';
import { runRepeatedPairedSelfPlayMatches, type RepeatedPairedSelfPlayMatchesResult,
  type RepeatedPairedSelfPlayOptions } from '../../src/domain/shogi/repeatedPairedSelfPlayMatches';
import type { SelfPlayParticipant, SelfPlayPlyRecord } from '../../src/domain/shogi/selfPlayGame';
import { resolveSearchEvaluationPreset } from '../../src/domain/shogi/searchEvaluationPresets';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import type { SearchClock } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { statisticKeys } from './quiescenceOrderingSuite';

/** The CLI's single explicit configuration; never changes normal game defaults. */
export const SELF_PLAY_CONFIG = Object.freeze({
  initialPosition: 'standard-hirate', pairCount: 3, maxPlies: 120, execution: 'synchronous-serial',
  participants: Object.freeze({ A: 'original', B: 'material' } as const),
  search: Object.freeze({ evaluationPreset: 'standard', moveOrdering: 'standard',
    maxTacticalDepth: 1, maxDepth: 4, timeLimitMilliseconds: 100 } as const),
} as const);

export const SELF_PLAY_LIMITATIONS = '3ペア6局はパイロット測定。同一棋譜を独立標本と見なさず、複数開始局面や定跡分岐を導入するまでは棋力差を判断できない。勝率・Elo・有意差・最適設定・既定化を判定しない。';
export const SELF_PLAY_TIMING = '100msは厳密な上限ではない。深さ1は合法手フォールバックとして時間制限から除外される。時間は未完了反復を含む探索APIの時間、統計は完了反復のみ。OS負荷・JIT・GCの影響を受ける。';

export type SelfPlayBenchmarkSettings = typeof SELF_PLAY_CONFIG.search & {
  readonly quiescenceMoveOrdering: typeof SELF_PLAY_CONFIG.participants[PairedSelfPlayParticipantId];
};
export interface SelfPlayBenchmarkDependencies {
  search?: typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch;
  clock?: SearchClock;
  runner?: (options: RepeatedPairedSelfPlayOptions<SelfPlayBenchmarkSettings, SelfPlayBenchmarkSettings>) => RepeatedPairedSelfPlayMatchesResult;
}

export function createSelfPlayParticipants(dependencies: SelfPlayBenchmarkDependencies = {}) {
  const search: SelfPlayParticipant<SelfPlayBenchmarkSettings>['search'] = (state, settings) =>
    (dependencies.search ?? analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch)(
      state, settings.maxDepth, settings.timeLimitMilliseconds,
      resolveSearchEvaluationPreset(settings.evaluationPreset), dependencies.clock,
      { moveOrdering: settings.moveOrdering, quiescence: {
        maxTacticalDepth: settings.maxTacticalDepth, moveOrdering: settings.quiescenceMoveOrdering,
      } },
    );
  const participant = (id: PairedSelfPlayParticipantId): SelfPlayParticipant<SelfPlayBenchmarkSettings> => ({
    search, settings: Object.freeze({ ...SELF_PLAY_CONFIG.search,
      quiescenceMoveOrdering: SELF_PLAY_CONFIG.participants[id] }),
  });
  return { a: participant('A'), b: participant('B') };
}

export function runSelfPlayBenchmark(dependencies: SelfPlayBenchmarkDependencies = {},
  initialState: BoardState = createInitialBoardState()): RepeatedPairedSelfPlayMatchesResult {
  return (dependencies.runner ?? runRepeatedPairedSelfPlayMatches)({
    initialState, ...createSelfPlayParticipants(dependencies),
    pairCount: SELF_PLAY_CONFIG.pairCount, maxPlies: SELF_PLAY_CONFIG.maxPlies,
  });
}

/** Fixed field order ignores object insertion order and all search/outcome data.
 * Drop piece IDs are retained, matching the existing LegalAction identity. */
export function gameSignature(actions: readonly LegalAction[]): string {
  const canonical = actions.map(a => a.kind === 'move'
    ? [a.kind, a.player, a.pieceType, a.from.row, a.from.col, a.to.row, a.to.col, a.promotion]
    : [a.kind, a.player, a.pieceType, a.pieceId, a.to.row, a.to.col, a.promotion]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// Decimal strings preserve bigint precision; non-finite spelling matches the existing benchmark.
export const selfPlayJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item)) ? String(item) : item);

const ids = ['A', 'B'] as const;
const seats = ['sente', 'gote'] as const;
const outcomeKeys = { a_win: 'aWins', b_win: 'bWins', draw: 'draws', max_plies: 'maxPlies', failed: 'failures' } as const;
type Statistic = typeof statisticKeys[number][0];
type CountField = typeof statisticKeys[number][number] | 'completedDepth';

function requireCount(value: unknown, field: string): asserts value is number | null {
  assert.ok(value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0), `Invalid observation: ${field}`);
}

/** Null means unavailable, never zero. Undefined/invalid observations abort the
 * report instead of fabricating successful measurements. The game runner owns
 * legality, PV, score and terminal validation; this layer validates aggregate inputs. */
export function summarizeObservations(plies: readonly SelfPlayPlyRecord[]) {
  const unavailable: Record<string, number> = {};
  const counts = (field: CountField): bigint | null => {
    let sum = 0n, missing = 0;
    for (const ply of plies) {
      requireCount(ply[field], field);
      if (ply[field] === null) missing++;
      else sum += BigInt(ply[field]);
    }
    unavailable[field] = missing;
    return missing ? null : sum;
  };
  let elapsedMilliseconds = 0, missingTime = 0, timedOutCount = 0, missingTimeout = 0;
  const completedDepthDistribution: Record<string, number> = {};
  for (const ply of plies) {
    const time = ply.elapsedMilliseconds;
    assert.ok(time === null || (typeof time === 'number' && Number.isFinite(time) && time >= 0), 'Invalid observation: elapsedMilliseconds');
    if (time === null) missingTime++;
    else elapsedMilliseconds += time;
    assert.ok(ply.timedOut === null || typeof ply.timedOut === 'boolean', 'Invalid observation: timedOut');
    if (ply.timedOut === null) missingTimeout++;
    else if (ply.timedOut) timedOutCount++;
    requireCount(ply.completedDepth, 'completedDepth');
    const depth = ply.completedDepth === null ? 'unavailable' : String(ply.completedDepth);
    completedDepthDistribution[depth] = (completedDepthDistribution[depth] ?? 0) + 1;
    for (const [key, total] of statisticKeys) {
      requireCount(ply[key], key); requireCount(ply[total], total);
      assert.ok(ply[key] === null || ply[total] === null || ply[total]! >= ply[key]!, `Invalid observation: ${total} < ${key}`);
    }
  }
  assert.ok(Number.isFinite(elapsedMilliseconds), 'Observation time sum overflow');
  unavailable.elapsedMilliseconds = missingTime;
  unavailable.timedOut = missingTimeout;
  unavailable.completedDepth = plies.filter(p => p.completedDepth === null).length;
  const deepest = Object.fromEntries(statisticKeys.map(([key]) => [key, counts(key)])) as Record<Statistic, bigint | null>;
  const completedTotals = Object.fromEntries(statisticKeys.map(([key, total]) => [key, counts(total)])) as Record<Statistic, bigint | null>;
  return { moveCount: plies.length, elapsedMilliseconds: missingTime ? null : elapsedMilliseconds,
    completedDepthDistribution, timedOutCount: missingTimeout ? null : timedOutCount,
    deepest, completedTotals, unavailable };
}

export function summarizeSelfPlay(result: RepeatedPairedSelfPlayMatchesResult) {
  const games = result.pairs.flatMap(pair => pair.result.games.map(game => {
    const plies = game.result.plies;
    const actions = plies.map(p => p.action);
    return { pairNumber: pair.pairNumber, gameNumber: game.gameNumber,
      sente: game.sente, gote: game.gote, outcome: game.outcome,
      detail: game.result.status === 'ended' ? game.result.gameResult
        : game.result.status === 'failed' ? game.result.failure : { reason: 'max_plies' },
      plyCount: plies.length,
      participants: Object.fromEntries(ids.map(id => [id,
        summarizeObservations(plies.filter(p => game[p.player] === id))])),
      actions, signature: gameSignature(actions), plies,
    };
  }));
  const outcomes = { ...result.summary };
  for (const [outcome, key] of Object.entries(outcomeKeys)) {
    assert.equal(outcomes[key], BigInt(games.filter(g => g.outcome === outcome).length), `Inconsistent outcome count: ${key}`);
  }
  const totalGames = BigInt(games.length);
  const outcomeCountSum = Object.values(outcomes).reduce((sum, n) => sum + n, 0n);
  assert.equal(totalGames, BigInt(result.pairs.length) * 2n, 'Two games required per pair');
  assert.equal(totalGames, outcomeCountSum, 'Inconsistent total game count');
  const participantSummary = (id: PairedSelfPlayParticipantId, seat?: Player) => {
    const selected = games.filter(g => seat === undefined || g[seat] === id);
    const ownWin: PairedSelfPlayOutcome = id === 'A' ? 'a_win' : 'b_win';
    const otherWin: PairedSelfPlayOutcome = id === 'A' ? 'b_win' : 'a_win';
    return { games: selected.length, outcomes: {
      wins: selected.filter(g => g.outcome === ownWin).length,
      losses: selected.filter(g => g.outcome === otherWin).length,
      draws: selected.filter(g => g.outcome === 'draw').length,
      maxPlies: selected.filter(g => g.outcome === 'max_plies').length,
      failures: selected.filter(g => g.outcome === 'failed').length,
    }, ...summarizeObservations(selected.flatMap(g => g.plies.filter(p => g[p.player] === id))) };
  };
  const frequencies = new Map<string, { signature: string; count: number; games: string[] }>();
  for (const game of games) {
    const item = frequencies.get(game.signature) ?? { signature: game.signature, count: 0, games: [] };
    item.count++; item.games.push(`${game.pairNumber}/${game.gameNumber}`);
    frequencies.set(game.signature, item);
  }
  return { games, summary: { outcomes, totalGames, outcomeCountSum, consistent: totalGames === outcomeCountSum,
    participants: Object.fromEntries(ids.map(id => [id, participantSummary(id)])),
    bySeat: Object.fromEntries(seats.map(seat => [seat,
      Object.fromEntries(ids.map(id => [id, participantSummary(id, seat)]))])),
    uniqueSignatures: frequencies.size, duplicateGames: games.length - frequencies.size,
    signatureFrequencies: [...frequencies.values()],
  } };
}

/** Output is deliberately separate from the synchronous game runner. Full ply
 * observations remain available even when a later observation/summary fails. */
export function runSelfPlayCli(dependencies: SelfPlayBenchmarkDependencies = {}, write = console.log): 0 | 1 {
  write(`CONFIG ${selfPlayJson(SELF_PLAY_CONFIG)}`);
  write('A=original / B=material。標準平手初期局面。各ペアはA先手/B後手→B先手/A後手。全局同期・直列実行。');
  write(SELF_PLAY_TIMING); write(SELF_PLAY_LIMITATIONS);
  try {
    const result = runSelfPlayBenchmark(dependencies);
    for (const pair of result.pairs) for (const game of pair.result.games) {
      write(`RECORD ${selfPlayJson({ pairNumber: pair.pairNumber, gameNumber: game.gameNumber,
        sente: game.sente, gote: game.gote, outcome: game.outcome, status: game.result.status,
        plies: game.result.plies })}`);
    }
    const report = summarizeSelfPlay(result);
    for (const { plies: _plies, ...game } of report.games) {
      write(`ペア${game.pairNumber} 第${game.gameNumber}局: 先手${game.sente}/後手${game.gote}, ${game.outcome}, ${game.plyCount}ply`);
      write(`GAME ${selfPlayJson(game)}`);
    }
    write(`SUMMARY ${selfPlayJson(report.summary)}`);
    write(`結果: ${selfPlayJson(report.summary.outcomes)}; ユニーク棋譜=${report.summary.uniqueSignatures}; 重複=${report.summary.duplicateGames}`);
    return result.summary.failures > 0n ? 1 : 0;
  } catch (error) {
    write(`ERROR ${selfPlayJson({ message: error instanceof Error ? error.message : String(error) })}`);
    return 1;
  }
}
