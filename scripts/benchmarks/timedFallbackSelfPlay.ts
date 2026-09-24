import { performance } from 'node:perf_hooks';
import type { BoardState } from '../../src/types/shogi';
import { createInitialBoardState } from '../../src/types/shogi';
import { runPairedSelfPlayMatch, type PairedSelfPlayOutcome, type PairedSelfPlayParticipantId } from '../../src/domain/shogi/pairedSelfPlayMatch';
import type { SelfPlayParticipant, SelfPlayPlyRecord } from '../../src/domain/shogi/selfPlayGame';
import { resolveSearchEvaluationPreset } from '../../src/domain/shogi/searchEvaluationPresets';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { SearchDiagnostics } from '../../src/domain/shogi/searchDiagnostics';

export interface MeasurementConfig {
  pairCount: number;
  maxPlies: number;
  timeLimitMilliseconds: number;
  maxDepth: number;
  evaluationPreset: 'standard';
  moveOrdering: 'standard';
  quiescenceMoveOrdering: 'original';
  maxTacticalDepth: number;
  initialPosition: 'standard-hirate';
}

export const DEFAULT_CONFIG: MeasurementConfig = {
  pairCount: 2, maxPlies: 120, timeLimitMilliseconds: 100, maxDepth: 4,
  evaluationPreset: 'standard', moveOrdering: 'standard',
  quiescenceMoveOrdering: 'original', maxTacticalDepth: 1, initialPosition: 'standard-hirate',
};

export type MeasurementPly = SelfPlayPlyRecord & {
  participant: PairedSelfPlayParticipantId;
  timeLimitMilliseconds: number;
  actualElapsedMilliseconds: number;
  resultSource: 'fallback' | 'completed-iteration';
};

export interface MeasurementGame {
  type: 'game';
  pairNumber: number;
  gameNumber: 1 | 2;
  executionIndex: number;
  sente: PairedSelfPlayParticipantId;
  gote: PairedSelfPlayParticipantId;
  outcome: PairedSelfPlayOutcome;
  status: 'ended' | 'max_plies' | 'failed';
  detail: unknown;
  plies: MeasurementPly[];
}

export type Search = typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch;

/** Only adds observations; rules, search, evaluation and move choice stay in existing APIs. */
export function runMeasurement(config: MeasurementConfig, options: {
  search?: Search;
  now?: () => number;
  initialState?: BoardState;
  onGame?: (game: MeasurementGame) => void;
  beforeSearch?: (position: BoardState) => unknown;
  probe?: boolean;
  onSearch?: (position: BoardState, result: ReturnType<Search>, timing: {
    startedAt: number; finishedAt: number; diagnostics: SearchDiagnostics | null; before: unknown;
  }) => void;
} = {}): MeasurementGame[] {
  if (!Number.isSafeInteger(config.pairCount) || config.pairCount < 1 ||
    !Number.isSafeInteger(config.maxPlies) || config.maxPlies < 1) {
    throw new RangeError('pairCount and maxPlies must be positive safe integers');
  }
  const search = options.search ?? analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch;
  const now = options.now ?? performance.now.bind(performance);
  const state = options.initialState ?? createInitialBoardState();
  const participant = (): SelfPlayParticipant<MeasurementConfig> => ({
    settings: { ...config },
    search: (position, settings) => {
      const before = options.beforeSearch?.(position);
      const diagnostics = options.probe ? new SearchDiagnostics() : undefined;
      const start = now();
      const result = search(position, settings.maxDepth, settings.timeLimitMilliseconds,
        resolveSearchEvaluationPreset(settings.evaluationPreset), undefined,
        { moveOrdering: settings.moveOrdering, quiescence: {
          maxTacticalDepth: settings.maxTacticalDepth, moveOrdering: settings.quiescenceMoveOrdering,
        } }, diagnostics);
      const finishedAt = now();
      const actualElapsedMilliseconds = finishedAt - start;
      if (!Number.isFinite(actualElapsedMilliseconds) || actualElapsedMilliseconds < 0) {
        throw new Error('Invalid monotonic search duration');
      }
      options.onSearch?.(position, result, { startedAt: start, finishedAt, diagnostics: diagnostics ?? null, before });
      return { ...result, actualElapsedMilliseconds };
    },
  });
  const a = participant(), b = participant();
  const games: MeasurementGame[] = [];
  for (let pairIndex = 0; pairIndex < config.pairCount; pairIndex++) {
    // AB→BA in odd pairs and BA→AB in even pairs balances first-game order.
    const swapped = pairIndex % 2 === 1;
    const result = runPairedSelfPlayMatch({ initialState: state,
      a: swapped ? b : a, b: swapped ? a : b, maxPlies: config.maxPlies });
    const globalId = (local: PairedSelfPlayParticipantId): PairedSelfPlayParticipantId =>
      swapped ? (local === 'A' ? 'B' : 'A') : local;
    for (const game of result.games) {
      const sente = globalId(game.sente), gote = globalId(game.gote);
      const outcome = swapped && (game.outcome === 'a_win' || game.outcome === 'b_win')
        ? (game.outcome === 'a_win' ? 'b_win' : 'a_win') : game.outcome;
      const plies = game.result.plies.map((ply): MeasurementPly => {
        if (ply.resultSource === undefined || ply.actualElapsedMilliseconds === undefined ||
          ply.elapsedMilliseconds === null || ply.completedDepth === null || ply.timedOut === null) {
          throw new Error('Timed search observation is incomplete');
        }
        return { ...ply, resultSource: ply.resultSource,
          actualElapsedMilliseconds: ply.actualElapsedMilliseconds,
          participant: ply.player === 'sente' ? sente : gote,
          timeLimitMilliseconds: config.timeLimitMilliseconds };
      });
      const record: MeasurementGame = {
        type: 'game', pairNumber: pairIndex + 1, gameNumber: game.gameNumber,
        executionIndex: games.length + 1, sente, gote, outcome, status: game.result.status,
        detail: game.result.status === 'ended' ? game.result.gameResult :
          game.result.status === 'failed' ? game.result.failure : { reason: 'max_plies' },
        plies,
      };
      games.push(record);
      options.onGame?.(record);
    }
  }
  return games;
}

const outcomeCounts = (games: readonly MeasurementGame[]) => ({
  aWins: games.filter(g => g.outcome === 'a_win').length,
  bWins: games.filter(g => g.outcome === 'b_win').length,
  draws: games.filter(g => g.outcome === 'draw').length,
  maxPlies: games.filter(g => g.outcome === 'max_plies').length,
  failures: games.filter(g => g.outcome === 'failed').length,
});

const percentile = (sorted: number[], fraction: number): number | null =>
  sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;

export function summarizePlies(plies: readonly MeasurementPly[]) {
  const fallback = plies.filter(p => p.resultSource === 'fallback');
  const depths: Record<string, number> = {};
  const bands: Record<string, { moves: number; fallbacks: number }> = {};
  const excess = plies.map(p => p.actualElapsedMilliseconds - p.timeLimitMilliseconds);
  const positive = excess.filter(n => n > 0).sort((a, b) => a - b);
  const excessBins = { withinLimit: 0, over0to5: 0, over5to20: 0, over20to100: 0, over100: 0 };
  for (const ply of plies) {
    if (ply.resultSource !== 'fallback' && ply.resultSource !== 'completed-iteration') throw new Error('Missing resultSource');
    if (ply.actualElapsedMilliseconds === undefined || ply.elapsedMilliseconds === null ||
      ply.completedDepth === null || ply.timedOut === null) throw new Error('Missing timed observation');
    const depth = String(ply.completedDepth);
    depths[depth] = (depths[depth] ?? 0) + 1;
    const lower = Math.floor((ply.ply - 1) / 20) * 20 + 1;
    const band = `${lower}-${lower + 19}`;
    bands[band] ??= { moves: 0, fallbacks: 0 };
    bands[band].moves++;
    if (ply.resultSource === 'fallback') bands[band].fallbacks++;
  }
  for (const value of excess) {
    if (value <= 0) excessBins.withinLimit++;
    else if (value <= 5) excessBins.over0to5++;
    else if (value <= 20) excessBins.over5to20++;
    else if (value <= 100) excessBins.over20to100++;
    else excessBins.over100++;
  }
  return {
    moves: plies.length, fallbackCount: fallback.length,
    fallbackRate: plies.length ? fallback.length / plies.length : null,
    fallbackPlies: fallback.map(p => p.ply), fallbackByPlyBand: bands,
    completedDepthDistribution: depths,
    timedOutCount: plies.filter(p => p.timedOut).length,
    actualOverLimit: { count: positive.length, rate: plies.length ? positive.length / plies.length : null,
      medianExcessMilliseconds: percentile(positive, .5), p95ExcessMilliseconds: percentile(positive, .95),
      maxExcessMilliseconds: positive.at(-1) ?? null, distribution: excessBins },
  };
}

/** Pure re-aggregation from JSONL game rows; no search result or in-memory runner needed. */
export function summarizeGames(games: readonly MeasurementGame[]) {
  const ids = ['A', 'B'] as const;
  const participants = Object.fromEntries(ids.map(id => {
    const ownGames = games;
    const ownWin = id === 'A' ? 'a_win' : 'b_win';
    const otherWin = id === 'A' ? 'b_win' : 'a_win';
    return [id, { games: ownGames.length,
      outcomes: { wins: ownGames.filter(g => g.outcome === ownWin).length,
        losses: ownGames.filter(g => g.outcome === otherWin).length,
        draws: ownGames.filter(g => g.outcome === 'draw').length,
        maxPlies: ownGames.filter(g => g.outcome === 'max_plies').length,
        failures: ownGames.filter(g => g.outcome === 'failed').length },
      ...summarizePlies(games.flatMap(g => g.plies.filter(p => p.participant === id))) }];
  }));
  const perGame = games.map(g => ({ pairNumber: g.pairNumber, gameNumber: g.gameNumber,
    executionIndex: g.executionIndex, sente: g.sente, gote: g.gote,
    outcome: g.outcome, status: g.status, plies: g.plies.length,
    participants: Object.fromEntries(ids.map(id => [id,
      summarizePlies(g.plies.filter(p => p.participant === id))])) }));
  const byFallback = Object.fromEntries(['withFallback', 'withoutFallback'].map(kind => {
    const selected = games.filter(g => g.plies.some(p => p.resultSource === 'fallback') === (kind === 'withFallback'));
    return [kind, { games: selected.length, outcomes: outcomeCounts(selected) }];
  }));
  return { totalGames: games.length, outcomes: outcomeCounts(games),
    totalPlies: games.reduce((n, g) => n + g.plies.length, 0),
    participants, byFallback, perGame };
}
