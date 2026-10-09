import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, closeSync, writeSync } from 'node:fs';
import { platform, release, arch, cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { executeLegalAction, getLegalActions, getQuiescenceLegalActionsWithDiagnostics } from '../src/domain/shogi/legalActions';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';

const [mode, out] = process.argv.slice(2);
assert.ok(['timed', 'fixed-off', 'fixed-on'].includes(mode) && out?.endsWith('.jsonl'),
  'Usage: npm run measure:action-revalidation -- timed|fixed-off|fixed-on OUT.jsonl');
const { positions, sourceSha256 } = replayPositions(SOURCE, TARGETS);
const options = { moveOrdering: 'standard' as const,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
const evaluation = resolveSearchEvaluationPreset('standard');
const clock = performance.now.bind(performance);
const fd = openSync(out, 'wx');
const emit = (value: object) => writeSync(fd, JSON.stringify(value) + '\n');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value,
  (key, item) => key === 'timestamp' ? 0 : key === 'recordId' ? 'replayed' : item)).digest('hex');
try {
  emit({ type: 'config', schema: 'action-revalidation-v1', mode,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    startedAt: new Date().toISOString(), source: SOURCE, sourceSha256,
    node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model,
    settings: { maxDepth: 4, timeLimitMilliseconds: 100, evaluation: 'standard', ...options },
    warmups: 2, runs: 5, execution: 'independent process per mode; synchronous serial',
    timing: 'inclusive coarse spans; injected search clock only; nested times must not be summed' });
  for (const position of positions) {
    const before = hash(position.state);
    // This metadata audit happens before warmup, outside all search measurements.
    const diagnostic = mode === 'fixed-on' ? new SearchDiagnostics(false, true, false, true) : undefined;
    diagnostic?.begin(clock(), Infinity, clock);
    const actions = getLegalActions(position.state, diagnostic);
    if (diagnostic) assert.deepEqual(getQuiescenceLegalActionsWithDiagnostics(position.state, diagnostic), actions);
    const successorHashes = actions.map(action => {
      const result = executeLegalAction(position.state, action, undefined, diagnostic);
      assert.equal(result.type, 'applied');
      return hash(result.state);
    });
    assert.equal(hash(position.state), before);
    emit({ type: 'position', id: position.id, stateSha256: position.stateSha256,
      positionKeySha256: position.positionKeySha256, historyLength: position.historyLength,
      rootCandidates: actions.length, actions, successorHashes, inputUnchanged: true });
  }
  for (let index = 0; index < 7; index++) for (const position of positions) {
    const input = protectSearchInput(position.state);
    const before = hash(input.snapshot);
    const diagnostics = mode === 'fixed-on' ? new SearchDiagnostics(false, true, false, true) : undefined;
    const start = clock();
    const result = mode === 'timed'
      ? analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, 100, evaluation, clock, options)
      : analyzeAlphaBetaSearch(input.snapshot, 1, evaluation, clock, options, diagnostics);
    const callElapsedMilliseconds = clock() - start;
    assert.equal(input.wasMutated(), false);
    assert.equal(hash(input.snapshot), before);
    emit({ type: 'sample', positionId: position.id, phase: index < 2 ? 'warmup' : 'measurement',
      run: index < 2 ? index + 1 : index - 1, apiElapsedMilliseconds: result.elapsedMilliseconds,
      callElapsedMilliseconds, completedDepth: 'completedDepth' in result ? result.completedDepth : result.depth,
      timedOut: 'timedOut' in result ? result.timedOut : false,
      fallback: 'resultSource' in result && result.resultSource === 'fallback',
      selectedAction: result.selectedAction, selectedEvaluation: result.selectedEvaluation,
      principalVariation: result.principalVariation, rootLegalActionCount: result.rootLegalActionCount,
      visitedPositionCount: result.visitedPositionCount,
      quiescenceVisitedPositionCount: result.quiescenceVisitedPositionCount,
      inputUnchanged: true, diagnostics: diagnostics ? {
        executeLegalAction: {
          calls: diagnostics.actionValidation!.executionBoard.timing['execute-action'].calls +
            diagnostics.actionValidation!.executionDrop.timing['execute-action'].calls,
          inclusiveMilliseconds: diagnostics.actionValidation!.executionBoard.timing['execute-action'].inclusiveMilliseconds +
            diagnostics.actionValidation!.executionDrop.timing['execute-action'].inclusiveMilliseconds,
        },
        actionValidation: diagnostics.actionValidation!.snapshot(),
        phases: diagnostics.phases, finished: diagnostics.finished,
      } : null });
  }
  emit({ type: 'end', endedAt: new Date().toISOString() });
} finally { closeSync(fd); }
console.log(`${out}: ${mode}, four positions, 2 warmups + 5 runs`);
