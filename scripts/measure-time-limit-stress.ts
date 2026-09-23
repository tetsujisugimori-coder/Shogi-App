import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { TIME_LIMIT_STRESS_POSITIONS } from './benchmarks/timeLimitStressPositions';
import { measureStressSample, summarize100ms, type StressMode, type StressSample } from './benchmarks/timeLimitStressMeasurement';

const output = resolve(process.argv[2] ?? 'docs/benchmarks/time-limit-stress-20260923.jsonl');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, '', 'utf8');
const emit = (row: object) => appendFileSync(output, `${JSON.stringify(row)}\n`, 'utf8');
const freezeDeep = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
};
const search = (state: Parameters<typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>[0],
  maxDepth: number, limit: number,
  options?: Parameters<typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>[5]) =>
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, maxDepth, limit, undefined, undefined, options);

emit({
  type: 'config', startedAt: new Date().toISOString(), node: process.version,
  os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
  execution: 'synchronous-serial', maxDepth: 4, warmupsPerCondition: 2, measurementsPerCondition: 5,
  modes: ['ordinary', 'quiescence-1'], timeLimitsMilliseconds: [100, 1000],
  ordinaryMoveOrdering: 'standard', quiescenceMoveOrdering: 'original',
  statisticScope: 'visitedPositionCount and quiescenceVisitedPositionCount are last completed iteration; total* are sums of completed iterations; all exclude interrupted work',
});

for (const position of TIME_LIMIT_STRESS_POSITIONS) {
  const state = freezeDeep(position.create());
  const rootLegalActionCount = getLegalActions(state).length;
  if (state.history.length !== position.expectedHistoryPly || state.status === 'ended' || rootLegalActionCount === 0) {
    throw new Error(`${position.id}: illegal or unexpected stress position`);
  }
  const boardPieceCount = state.squares.flat().filter((square) => square.piece !== null).length;
  const quiescenceProbe = analyzeAlphaBetaSearch(state, 1, undefined, undefined, { quiescence: { maxTacticalDepth: 1 } });
  const snapshot = JSON.stringify(state);
  emit({
    type: 'position', positionId: position.id, origin: position.origin,
    provenance: position.provenance, reproduction: position.reproduction,
    historyPly: state.history.length, rootLegalActionCount, boardPieceCount, status: state.status,
    positionKeySha256: createHash('sha256').update(createPositionKey(state)).digest('hex'),
    quiescenceDepthOneVisitedPositionCount: quiescenceProbe.quiescenceVisitedPositionCount,
  });
  for (const mode of ['ordinary', 'quiescence-1'] as const satisfies readonly StressMode[]) {
    for (const timeLimitMilliseconds of [100, 1000]) {
      const samples: StressSample[] = [];
      for (let index = 0; index < 7; index += 1) {
        const sample = measureStressSample({
          position, state, rootLegalActionCount, mode,
          phase: index < 2 ? 'warmup' : 'measurement', run: index < 2 ? index + 1 : index - 1,
          timeLimitMilliseconds, now: performance.now.bind(performance), search,
        });
        samples.push(sample);
        emit(sample);
      }
      if (timeLimitMilliseconds === 100) {
        emit({ type: 'summary', positionId: position.id, mode, timeLimitMilliseconds,
          ...summarize100ms(samples) });
      }
    }
  }
  if (JSON.stringify(state) !== snapshot) throw new Error(`${position.id}: input position changed during search`);
}
emit({ type: 'end', finishedAt: new Date().toISOString() });
console.log(output);
