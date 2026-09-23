import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegalActions } from '../domain/shogi/legalActions';
import { createPositionKey } from '../domain/shogi/repetition';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { TIME_LIMIT_STRESS_POSITIONS } from '../../scripts/benchmarks/timeLimitStressPositions';
import { measureStressSample, summarize100ms } from '../../scripts/benchmarks/timeLimitStressMeasurement';
import selfPlayActions from '../../scripts/benchmarks/fixtures/self-play-99-actions.json';

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

describe('time-limit stress measurement', () => {
  it('keeps the compact replay line identical to the saved first real self-play record', () => {
    const raw = readFileSync(resolve(process.cwd(), 'docs/quiescence-ordering-self-play-output.txt'), 'utf8');
    const line = raw.split(/\r?\n/).find((item) => item.startsWith('RECORD '));
    if (!line) throw new Error('Missing saved self-play record');
    const record = JSON.parse(line.slice('RECORD '.length)) as {
      pairNumber: number; gameNumber: number; plies: { action: unknown }[];
    };
    expect([record.pairNumber, record.gameNumber, record.plies.length]).toEqual([1, 1, 99]);
    expect(selfPlayActions).toEqual(record.plies.map((ply) => ply.action));
  });

  it('replays all positions deterministically through legal moves and retains real history lengths', () => {
    for (const position of TIME_LIMIT_STRESS_POSITIONS) {
      const first = position.create();
      const second = position.create();
      expect(first.history.length, position.id).toBe(position.expectedHistoryPly);
      expect(first.moveNumber, position.id).toBe(position.expectedHistoryPly + 1);
      expect(first.status, position.id).not.toBe('ended');
      expect(getLegalActions(first).length, position.id).toBeGreaterThan(0);
      expect(createPositionKey(first), position.id).toBe(createPositionKey(second));
      expect(first.history, position.id).toEqual(second.history);
      expect(first.positionHistory, position.id).toEqual(second.positionHistory);
      expect(first.positionSnapshots, position.id).toEqual(second.positionSnapshots);
    }
  });

  it('times only the search call and emits required observations without changing a frozen input', () => {
    const position = TIME_LIMIT_STRESS_POSITIONS.find((item) => item.id === 'saved-self-play-50');
    if (!position) throw new Error('Missing saved self-play position');
    const state = freezeDeep(position.create());
    const snapshot = JSON.stringify(state);
    const clockReads: number[] = [];
    const sample = measureStressSample({
      position, state, rootLegalActionCount: getLegalActions(state).length,
      mode: 'quiescence-1', phase: 'measurement', run: 3, timeLimitMilliseconds: 100,
      now: () => { clockReads.push(1); return clockReads.length === 1 ? 10 : 120; },
      search: (input, depth, limit, options) => {
        expect(clockReads).toHaveLength(1);
        expect(depth).toBe(4);
        expect(limit).toBe(100);
        expect(options).toEqual({ quiescence: { maxTacticalDepth: 1 } });
        return analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input, depth, 0, undefined, () => 0, options);
      },
    });
    expect(clockReads).toHaveLength(2);
    expect(sample).toMatchObject({
      type: 'sample', positionId: position.id, origin: 'saved-self-play', historyPly: 50,
      mode: 'quiescence-1', phase: 'measurement', run: 3, timeLimitMilliseconds: 100,
      actualElapsedMilliseconds: 110, completedDepth: 1, timedOut: true,
    });
    for (const key of ['rootLegalActionCount', 'visitedPositionCount', 'quiescenceVisitedPositionCount',
      'totalVisitedPositionCount', 'totalQuiescenceVisitedPositionCount', 'depthOneElapsedMilliseconds',
      'selectedAction'] as const) expect(sample[key]).toBeDefined();
    expect(sample.selectedAction).not.toBeNull();
    expect(sample.totalVisitedPositionCount).toBe(sample.visitedPositionCount);
    expect(sample.totalQuiescenceVisitedPositionCount).toBe(sample.quiescenceVisitedPositionCount);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('summarizes retained 100ms samples with the stated thresholds', () => {
    const position = TIME_LIMIT_STRESS_POSITIONS[0];
    const state = position.create();
    const search = (input: typeof state) => analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input, 1, 0, undefined, () => 0);
    const samples = [101, 105, 106, 300, 500].map((elapsed, index) => {
      let reads = 0;
      return measureStressSample({
        position, state, rootLegalActionCount: getLegalActions(state).length,
        mode: 'ordinary', phase: 'measurement', run: index + 1, timeLimitMilliseconds: 100,
        now: () => reads++ === 0 ? 0 : elapsed, search,
      });
    });
    expect(summarize100ms(samples)).toEqual({
      maxMilliseconds: 500, medianMilliseconds: 106,
      over105MillisecondsCount: 3, atLeast300MillisecondsCount: 2,
    });
  });
});
