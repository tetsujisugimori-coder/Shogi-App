import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInitialBoardState, type BoardState } from '../../src/types/shogi';
import { executeLegalAction, getLegalActions } from '../../src/domain/shogi/legalActions';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import { areLegalActionsEqual } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import type { MeasurementGame } from './timedFallbackSelfPlay';

export const SOURCE = 'docs/benchmarks/timed-fallback-100ms-20260924.jsonl';
export const POSITION_IDS = [
  { game: 1, ply: 5, band: 'opening' },
  { game: 1, ply: 30, band: 'opening' },
  { game: 2, ply: 54, band: 'middle' },
  { game: 3, ply: 55, band: 'middle' },
  { game: 4, ply: 89, band: 'late' },
  { game: 2, ply: 92, band: 'late' },
  { game: 1, ply: 115, band: 'late' },
] as const;

export function replayPositions(source = SOURCE, requested: readonly { game: number; ply: number; band: string }[] = POSITION_IDS) {
  const bytes = readFileSync(source);
  const rows = bytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const games = rows.filter(row => row.type === 'game') as MeasurementGame[];
  const positions = [] as Array<{ id: string; band: string; state: BoardState; sourceResult: string;
    sourceActualMilliseconds: number; stateSha256: string; positionKeySha256: string; historyLength: number }>;
  for (const item of requested) {
    const game = games[item.game - 1];
    assert.equal(game.executionIndex, item.game);
    let state = createInitialBoardState();
    for (const ply of game.plies) {
      assert.equal(ply.positionKey, createPositionKey(state));
      if (ply.ply === item.ply) {
        assert.equal(state.history.length, item.ply - 1);
        positions.push({ id: `g${item.game}-p${item.ply}`, band: item.band, state,
          sourceResult: ply.resultSource, sourceActualMilliseconds: ply.actualElapsedMilliseconds,
          stateSha256: createHash('sha256').update(JSON.stringify({ ...state, recordId: 'replayed' })).digest('hex'),
          positionKeySha256: createHash('sha256').update(ply.positionKey).digest('hex'),
          historyLength: state.history.length });
        break;
      }
      assert.ok(getLegalActions(state).some(action => areLegalActionsEqual(action, ply.action)));
      const next = executeLegalAction(state, ply.action, { proposer: 'local_ai' });
      assert.equal(next.type, 'applied');
      if (next.type === 'applied') state = next.state;
    }
  }
  assert.equal(positions.length, requested.length);
  return { positions, sourceSha256: createHash('sha256').update(bytes).digest('hex') };
}

export type Sample = {
  type: 'sample'; positionId: string; band: string; mode: 'timed' | 'fixed';
  probe: boolean; phase: 'warmup' | 'measurement'; run: number;
  actualElapsedMilliseconds: number; apiElapsedMilliseconds: number;
  completedDepth: number; resultSource: string; timedOut: boolean;
  action: unknown; evaluation: number | null; pv: unknown;
  diagnostics: null | { phases: unknown; apiOtherMilliseconds: number; totalMilliseconds: number;
    crossedDeadlinePhase: string | null; interruptedPhase: string | null };
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length / 2) - 1] : null;
};

export function summarizeSamples(samples: Sample[]) {
  const rows = samples.filter(s => s.phase === 'measurement');
  return ['opening', 'middle', 'late'].flatMap(band =>
    (['timed', 'fixed'] as const).flatMap(mode => [false, true].map(probe => {
      const own = rows.filter(s => s.band === band && s.mode === mode && s.probe === probe);
      const phaseNames = ['root-legal', 'normal-legal', 'normal-order', 'see', 'normal-execute', 'normal-other', 'quiescence'] as const;
      return { band, mode, probe, samples: own.length, positions: [...new Set(own.map(s => s.positionId))],
        depthOneCompletion: own.filter(s => s.completedDepth >= 1).length,
        fallback: own.filter(s => s.resultSource === 'fallback').length,
        actualMedianMilliseconds: median(own.map(s => s.actualElapsedMilliseconds)),
        actualMaxMilliseconds: Math.max(0, ...own.map(s => s.actualElapsedMilliseconds)),
        over100Count: own.filter(s => s.actualElapsedMilliseconds > 100).length,
        over105Count: own.filter(s => s.actualElapsedMilliseconds > 105).length,
        crossedDeadlinePhases: Object.fromEntries([...new Set(own.map(s => s.diagnostics?.crossedDeadlinePhase).filter(Boolean))]
          .map(phase => [phase, own.filter(s => s.diagnostics?.crossedDeadlinePhase === phase).length])),
        interruptedPhases: Object.fromEntries([...new Set(own.map(s => s.diagnostics?.interruptedPhase).filter(Boolean))]
          .map(phase => [phase, own.filter(s => s.diagnostics?.interruptedPhase === phase).length])),
        phaseMedianMilliseconds: probe ? Object.fromEntries(phaseNames.map(name => [name, median(own.map(s =>
          (s.diagnostics!.phases as Record<string, { milliseconds: number }>)[name].milliseconds))])) : null,
        apiOtherMedianMilliseconds: probe ? median(own.map(s => s.diagnostics!.apiOtherMilliseconds)) : null,
      };
    })));
}
