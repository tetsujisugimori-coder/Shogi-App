// Reference timings, never a CI threshold:
// npx tsx scripts/measure-see-move-ordering.ts [source checkout] [fixed|timed|all]
// Run sequentially on each revision, without concurrent tests/builds.
// Each position / time budget runs in a fresh process to isolate JIT history.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import type * as Search from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { createInitialBoardState, type PieceType, type Player } from '../src/types/shogi';

const sourceRoot = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
const mode = process.argv[3] ?? 'all';
assert(['fixed', 'timed', 'all'].includes(mode), 'Mode must be fixed, timed or all');
type Engine = Pick<typeof Search, 'analyzeAlphaBetaSearch' |
  'analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch' | 'orderAlphaBetaNodeActions'> & {
  getLegalActions: typeof import('../src/domain/shogi/legalActions').getLegalActions;
  seeCallCount: number;
  resetSeeCallCount: () => void;
};

// Compile the chosen checkout in memory using the existing dev dependency.
// Timings use unmodified source. A separate untimed build wraps only the public
// SEE entry for counting; neither checkout nor the production API is modified.
async function loadEngine(countCalls: boolean): Promise<Engine> {
  const result = await build({
    stdin: {
      contents: `export * from './src/domain/shogi/twoPlyAlphaBetaAi';
        export { getLegalActions } from './src/domain/shogi/legalActions';
        ${countCalls ? "export { seeCallCount, resetSeeCallCount } from './src/domain/shogi/staticExchangeEvaluation';" : ''}`,
      resolveDir: sourceRoot, loader: 'ts',
    },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24',
    plugins: countCalls ? [{ name: 'count-public-see-calls', setup(builder) {
      builder.onLoad({ filter: /staticExchangeEvaluation\.ts$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const signature = 'export function evaluateStaticExchange(';
        assert(source.includes(signature), 'Expected public SEE entry for instrumentation');
        return { loader: 'ts', contents: source.replace(signature, 'function uncountedStaticExchange(') + `
          export let seeCallCount = 0;
          export function resetSeeCallCount() { seeCallCount = 0; }
          export function evaluateStaticExchange(...args: Parameters<typeof uncountedStaticExchange>) {
            seeCallCount++;
            return uncountedStaticExchange(...args);
          }` };
      });
    } }] : [],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
type Placement = [number, number, PieceType, Player];
function position(pieces: Placement[]) {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  const kings: Placement[] = [[8, 8, 'king', 'sente'], [0, 8, 'king', 'gote']];
  for (const [row, col, type, player] of [...kings, ...pieces]) {
    state.squares[row][col].piece = { id: `${player}-${type}-${row}-${col}`, type, player };
  }
  return state;
}
// Same placement as moveOrderingBenefitState in shogi-two-ply-minimax-ai.test.ts.
const tactical = position([
  [4, 4, 'rook', 'sente'],
  [3, 4, 'pawn', 'gote'], [4, 5, 'silver', 'gote'], [4, 6, 'rook', 'gote'],
  [5, 4, 'pawn', 'sente'],
]);
const results = [
  ['initial', createInitialBoardState()], ['moveOrderingBenefitState', tactical],
  ['singleCapture', position([[4, 4, 'rook', 'sente'], [4, 5, 'pawn', 'gote']])],
  ['multipleCaptures', position([[4, 4, 'rook', 'sente'], [4, 5, 'pawn', 'gote'], [3, 4, 'silver', 'gote']])],
] as const;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const comparable = (result: Search.AlphaBetaSearchResult) => ({ ...result, elapsedMilliseconds: 0 });
function measure(engine: Engine, counted: Engine) {
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
    sourceRoot, node: process.version, cpu: cpus()[0].model, mode, depth: 3, warmups: 3, samples: 7,
    positions: results.filter(([name]) => name === process.argv[4]).map(([name, state]) => {
      const before = structuredClone(state);
      const actions = engine.getLegalActions(state);
      const rootCaptureCount = actions.filter((action) => action.kind === 'move' &&
        state.squares[action.to.row][action.to.col].piece?.player !== action.player &&
        state.squares[action.to.row][action.to.col].piece !== null).length;
      if (name === 'singleCapture') assert.equal(rootCaptureCount, 1);
      if (name === 'multipleCaptures') assert.equal(rootCaptureCount, 2);
      counted.resetSeeCallCount();
      counted.orderAlphaBetaNodeActions(state, actions);
      const rootOrderingSeeCalls = counted.seeCallCount;
      let fixed;
      if (mode !== 'timed') {
        for (let i = 0; i < 3; i++) engine.analyzeAlphaBetaSearch(state, 3);
        const runs = Array.from({ length: 7 }, () => engine.analyzeAlphaBetaSearch(state, 3));
        const reference = comparable(runs[0]);
        for (const run of runs) assert.deepEqual(comparable(run), reference);
        counted.resetSeeCallCount();
        assert.deepEqual(comparable(counted.analyzeAlphaBetaSearch(state, 3)), reference);
        fixed = { result: reference, seeCalls: counted.seeCallCount,
          medianMilliseconds: median(runs.map((run) => run.elapsedMilliseconds)),
          times: runs.map((run) => run.elapsedMilliseconds) };
      }
      const timed = mode === 'fixed' ? [] : [Number(process.argv[5])].map((timeLimitMilliseconds) => {
        assert([100, 250, 500].includes(timeLimitMilliseconds));
        const run = () => engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 6, timeLimitMilliseconds);
        for (let i = 0; i < 3; i++) run();
        const runs = Array.from({ length: 7 }, () => {
          const result = run();
          assert.equal(result.completedDepth, result.iterations.at(-1)?.depth);
          assert.deepEqual(result.iterations.map((iteration) => iteration.depth),
            Array.from({ length: result.completedDepth }, (_, i) => i + 1));
          return {
            requestedMaxDepth: result.requestedMaxDepth, completedDepth: result.completedDepth,
            timedOut: result.timedOut, selectedAction: result.selectedAction,
            selectedEvaluation: result.selectedEvaluation, visitedPositionCount: result.visitedPositionCount,
            totalVisitedPositionCount: result.totalVisitedPositionCount,
            elapsedMilliseconds: result.elapsedMilliseconds,
          };
        });
        const depthDistribution: Record<string, number> = {};
        for (const { completedDepth } of runs) depthDistribution[completedDepth] = (depthDistribution[completedDepth] ?? 0) + 1;
        return { timeLimitMilliseconds, depthDistribution,
          medianMilliseconds: median(runs.map((run) => run.elapsedMilliseconds)), runs };
      });
      assert.deepEqual(state, before);
      process.stderr.write(`Measured ${name} (${mode})\n`);
      return { name, rootCaptureCount, rootOrderingSeeCalls, fixed, timed };
    }),
  };
}

let report: ReturnType<typeof measure>;
if (process.argv[4]) {
  report = measure(await loadEngine(false), await loadEngine(true));
} else {
  const runCase = (name: string, caseMode: 'fixed' | 'timed', limit?: number): ReturnType<typeof measure> =>
    JSON.parse(execFileSync(process.execPath, [
      ...process.execArgv, import.meta.filename, sourceRoot, caseMode, name, ...(limit ? [String(limit)] : []),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const cases = results.map(([name]) => {
    const fixed = mode !== 'timed' ? runCase(name, 'fixed') : undefined;
    const timed = mode !== 'fixed' ? [100, 250, 500].map((limit) => runCase(name, 'timed', limit)) : [];
    const base = fixed ?? timed[0];
    return { ...base, positions: [{ ...base.positions[0], fixed: fixed?.positions[0].fixed,
      timed: timed.flatMap((result) => result.positions[0].timed) }] };
  });
  report = { ...cases[0], mode, positions: cases.flatMap((result) => result.positions) };
}
console.log(JSON.stringify(report, (_key, value: unknown) =>
  typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2));
