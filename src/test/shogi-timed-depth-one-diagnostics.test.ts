import { describe, expect, it } from 'vitest';
import { replayPositions } from '../../scripts/benchmarks/timedDepthOneDiagnostics';
import { SearchDiagnostics } from '../domain/shogi/searchDiagnostics';
import { protectSearchInput } from '../domain/shogi/selfPlayGame';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { resolveSearchEvaluationPreset } from '../domain/shogi/searchEvaluationPresets';

describe('timed depth-one diagnostic inputs and invariants', () => {
  it('replays distinct saved positions with complete move history', () => {
    const { positions } = replayPositions();
    expect(positions).toHaveLength(7);
    expect(new Set(positions.map(p => p.positionKeySha256)).size).toBeGreaterThanOrEqual(5);
    for (const position of positions) expect(position.state.history).toHaveLength(position.historyLength);
    expect(positions.some(p => p.sourceResult === 'fallback')).toBe(true);
    expect(positions.some(p => p.sourceResult === 'completed-iteration')).toBe(true);
  });

  it('preserves fixed-depth action, evaluation and PV with the optional probe', () => {
    const { positions } = replayPositions();
    const state = protectSearchInput(positions[0].state).snapshot;
    const evaluation = resolveSearchEvaluationPreset('standard');
    const options = { moveOrdering: 'standard' as const,
      quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
    const plain = analyzeAlphaBetaSearch(state, 1, evaluation, undefined, options);
    const probe = new SearchDiagnostics();
    const measured = analyzeAlphaBetaSearch(state, 1, evaluation, undefined, options, probe);
    const account = probe.finished!;
    expect([measured.selectedAction, measured.selectedEvaluation, measured.principalVariation])
      .toEqual([plain.selectedAction, plain.selectedEvaluation, plain.principalVariation]);
    expect(probe.phases['root-legal'].calls).toBe(1);
    expect(probe.phases['root-piece-moves'].calls).toBeGreaterThan(0);
    expect(probe.phases.quiescence.calls).toBeGreaterThan(0);
    expect(probe.phases['q-evaluate'].calls).toBeGreaterThan(0);
    expect(probe.phases.see.calls).toBe(0);
    const phaseSum = Object.values(probe.phases).reduce((total, item) => total + item.milliseconds, 0);
    expect(Math.abs(account.totalMilliseconds - phaseSum - account.apiOtherMilliseconds)).toBeLessThan(1);
  });

  it('uses the injected clock for phase timing, deadline crossing and API finish', () => {
    const { positions } = replayPositions();
    const state = protectSearchInput(positions[0].state).snapshot;
    let tick = 1000;
    const clock = () => ++tick;
    const probe = new SearchDiagnostics();
    const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 4, 5,
      resolveSearchEvaluationPreset('standard'), clock, undefined, probe);
    expect(result.timedOut).toBe(true);
    expect(result.resultSource).toBe('fallback');
    expect(probe.finished?.totalMilliseconds).toBe(result.elapsedMilliseconds);
    expect(probe.crossedDeadlinePhase).not.toBeNull();
    expect(probe.phases['root-legal'].milliseconds).toBeGreaterThan(0);
    expect(probe.longestCheckInterval.milliseconds).toBeGreaterThan(0);
    const phaseSum = Object.values(probe.phases).reduce((total, item) => total + item.milliseconds, 0);
    expect(probe.finished!.apiOtherMilliseconds + phaseSum).toBe(result.elapsedMilliseconds);
  });

  it('attributes a deadline crossing to the measured phase on a non-performance clock', () => {
    const ticks = [102, 106];
    const probe = new SearchDiagnostics();
    probe.begin(100, 5, () => ticks.shift()!);
    probe.measure('root-legal', () => {});
    expect(probe.finish(106)).toEqual({ apiOtherMilliseconds: 2, totalMilliseconds: 6 });
    expect(probe.phases['root-legal'].milliseconds).toBe(4);
    expect(probe.crossedDeadlinePhase).toBe('root-legal');
  });

  it('accounts for every activity from the exact deadline to the first check', () => {
    const ticks = [102, 108];
    const probe = new SearchDiagnostics();
    probe.begin(100, 5, () => ticks.shift()!);
    probe.measure('normal-execute', () => {});
    probe.checked(110);
    expect(probe.deadlineObservation).toEqual({ deadlineAt: 105, checkedAt: 110,
      milliseconds: 5, activities: { 'normal-execute': 3, 'api-other': 2 } });
  });

  it('records depth-one completion and an interrupted candidate with one injected clock', () => {
    const { positions } = replayPositions();
    const state = protectSearchInput(positions[0].state).snapshot;
    const evaluation = resolveSearchEvaluationPreset('standard');
    const options = { moveOrdering: 'standard' as const,
      quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
    const run = (limit: number) => {
      let time = 0;
      const diagnostic = new SearchDiagnostics();
      const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 1, limit,
        evaluation, () => ++time, options, diagnostic);
      return { result, diagnostic };
    };
    const full = run(1_000_000);
    const completed = full.diagnostic.depthOne!;
    expect(completed.status).toBe('completed');
    expect(completed.completedCandidates).toBe(completed.rootCandidates);
    expect(completed.visitedNodes).toBeGreaterThanOrEqual(completed.rootCandidates);
    expect(completed.quiescenceCalls).toBeGreaterThan(0);
    expect(full.result.completedDepth).toBe(1);
    const limit = Math.floor((completed.rootGeneratedAt + completed.finishedAt!) / 2);
    const partial = run(limit);
    const interrupted = partial.diagnostic.depthOne!;
    expect(partial.result.resultSource).toBe('fallback');
    expect(partial.result.completedDepth).toBe(0);
    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.rootCandidates).toBe(completed.rootCandidates);
    expect(interrupted.completedCandidates).toBeGreaterThan(0);
    expect(interrupted.completedCandidates).toBeLessThan(interrupted.rootCandidates);
    expect(interrupted.currentCandidate).not.toBeNull();
    expect(interrupted.interruptedStage).not.toBeNull();
    const gap = partial.diagnostic.deadlineObservation!;
    expect(gap.deadlineAt).toBe(1 + limit);
    expect(gap.checkedAt).toBeGreaterThanOrEqual(gap.deadlineAt);
    expect(Object.values(gap.activities).reduce((sum, value) => sum + value, 0)).toBe(gap.milliseconds);
    const phaseSum = Object.values(interrupted.postRootPhases!).reduce((sum, value) => sum + value, 0);
    expect(phaseSum + interrupted.postRootOtherMilliseconds!).toBe(interrupted.postRootMilliseconds);
  });
});
