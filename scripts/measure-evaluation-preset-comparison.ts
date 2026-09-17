// Reference timings only; never a CI threshold. Run with: npx tsx scripts/measure-evaluation-preset-comparison.ts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createInitialBoardState } from '../src/types/shogi';
import { analyzeEvaluationPresetComparison } from '../src/domain/shogi/evaluationPresetComparison';
import { executeMove } from '../src/domain/shogi';
import { formatLegalActionNotation } from '../src/application/searchPrincipalVariation';

let state = createInitialBoardState();
for (const [from, to] of [
  [{ row: 6, col: 2 }, { row: 5, col: 2 }], [{ row: 2, col: 6 }, { row: 3, col: 6 }],
  [{ row: 6, col: 3 }, { row: 5, col: 3 }], [{ row: 2, col: 5 }, { row: 3, col: 5 }],
]) {
  const execution = executeMove(state, from, to);
  if (execution.type !== 'applied') throw new Error('Reference move must be legal.');
  state = execution.state;
}
const before = structuredClone(state);
const warmup = analyzeEvaluationPresetComparison(state, 3);
const runs = Array.from({ length: 5 }, () => {
  const started = performance.now();
  const results = analyzeEvaluationPresetComparison(state, 3);
  const totalMilliseconds = performance.now() - started;
  results.forEach((result, index) => assert.deepEqual({ ...result, elapsedMilliseconds: 0 }, { ...warmup[index], elapsedMilliseconds: 0 }));
  return { totalMilliseconds, results };
});
assert.deepEqual(state, before);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({
  position: '平手初期局面から ▲7六歩 △3四歩 ▲6六歩 △4四歩（先手番）', depth: 3,
  node: process.version, warmups: 1, samples: runs.length,
  totalMedianMilliseconds: median(runs.map((run) => run.totalMilliseconds)),
  presets: warmup.map((result, index) => ({
    presetId: result.presetId, medianMilliseconds: median(runs.map((run) => run.results[index].elapsedMilliseconds)),
    selectedNotation: result.selectedAction ? formatLegalActionNotation(state, result.selectedAction) : null,
    selectedEvaluation: result.selectedEvaluation, visitedPositionCount: result.visitedPositionCount,
    cutoffCount: result.cutoffCount, skippedActionCount: result.skippedActionCount,
  })),
  runs,
}, null, 2));
