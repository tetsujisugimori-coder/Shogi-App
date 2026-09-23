import { describe, expect, it } from 'vitest';
import { replayPositions } from '../../scripts/benchmarks/timedDepthOneDiagnostics';
import { SearchDiagnostics } from '../domain/shogi/searchDiagnostics';
import { analyzeAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
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
    const state = positions[0].state;
    const evaluation = resolveSearchEvaluationPreset('standard');
    const options = { moveOrdering: 'standard' as const,
      quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
    const plain = analyzeAlphaBetaSearch(state, 1, evaluation, undefined, options);
    const probe = new SearchDiagnostics();
    const measured = analyzeAlphaBetaSearch(state, 1, evaluation, undefined, options, probe);
    const account = probe.finish();
    expect([measured.selectedAction, measured.selectedEvaluation, measured.principalVariation])
      .toEqual([plain.selectedAction, plain.selectedEvaluation, plain.principalVariation]);
    expect(probe.phases['root-legal'].calls).toBe(1);
    expect(probe.phases.quiescence.calls).toBeGreaterThan(0);
    expect(probe.phases.see.calls).toBe(0);
    const phaseSum = Object.values(probe.phases).reduce((total, item) => total + item.milliseconds, 0);
    expect(Math.abs(account.totalMilliseconds - phaseSum - account.apiOtherMilliseconds)).toBeLessThan(1);
  });
});
