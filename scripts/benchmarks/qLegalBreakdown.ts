import type { QLegalCounts, SearchDiagnostics } from '../../src/domain/shogi/searchDiagnostics';
import { median, TARGETS, type PostRootSample } from './postRootDepthOne';

export type QLegalSample = Omit<PostRootSample, 'diagnostics'> & {
  diagnostics: null | (NonNullable<PostRootSample['diagnostics']> & { qLegalCounts: QLegalCounts });
};
export type FixedProbe = {
  type: 'fixed-probe'; positionId: string; phase: 'warmup' | 'measurement'; run: number;
  apiElapsedMilliseconds: number; action: unknown; evaluation: number | null;
  diagnostics: { phases: SearchDiagnostics['phases']; qLegalCounts: QLegalCounts;
    finished: NonNullable<SearchDiagnostics['finished']> };
};

export const CHILD_PHASES = [
  'q-board-moves', 'q-board-pseudo', 'q-board-simulate', 'q-board-own-check',
  'q-hand-drops', 'q-drop-board-setup', 'q-drop-own-check', 'q-drop-pawn-mate',
] as const satisfies readonly (keyof SearchDiagnostics['phases'])[];

export function summarizeQLegal(samples: QLegalSample[], fixed: FixedProbe[] = []) {
  return TARGETS.map(target => {
    const positionId = `g${target.game}-p${target.ply}`;
    const measured = samples.filter(row => row.positionId === positionId && row.phase === 'measurement');
    const off = measured.filter(row => !row.probe);
    const on = measured.filter(row => row.probe);
    const full = fixed.filter(row => row.positionId === positionId && row.phase === 'measurement');
    const detailed = full.length ? full : on;
    const phase = (name: keyof SearchDiagnostics['phases']) => ({
      calls: detailed.map(row => row.diagnostics!.phases[name].calls),
      exclusiveMedianMilliseconds: median(detailed.map(row => row.diagnostics!.phases[name].milliseconds)),
      inclusiveMedianMilliseconds: median(detailed.map(row => row.diagnostics!.phases[name].inclusiveMilliseconds ?? 0)),
      maximumSingleMilliseconds: Math.max(0, ...detailed.map(row => row.diagnostics!.phases[name].maxMilliseconds ?? 0)),
    });
    return { positionId, offSamples: off.length,
      offApiMedianMilliseconds: median(off.map(row => row.apiElapsedMilliseconds)),
      offFallback: off.filter(row => row.resultSource === 'fallback').length,
      offDepths: off.map(row => row.completedDepth), offActions: off.map(row => row.action),
      onSamples: on.length, timedQCalls: on.map(row => row.diagnostics!.phases['q-legal'].calls),
      fixedSamples: full.length, fixedApiMedianMilliseconds: median(full.map(row => row.apiElapsedMilliseconds)),
      rootCandidates: on.map(row => row.diagnostics!.depthOne!.rootCandidates),
      qLegal: phase('q-legal'),
      phases: Object.fromEntries(CHILD_PHASES.map(name => [name, phase(name)])),
      counts: Object.fromEntries((Object.keys(detailed[0]?.diagnostics?.qLegalCounts ?? {}) as (keyof QLegalCounts)[])
        .map(name => [name, detailed.map(row => row.diagnostics!.qLegalCounts[name])])),
    };
  });
}
