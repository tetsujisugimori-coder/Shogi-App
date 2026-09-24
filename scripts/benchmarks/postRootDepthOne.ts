import type { DepthOneDiagnostic, DeadlineObservation, SearchDiagnostics } from '../../src/domain/shogi/searchDiagnostics';

export const TARGETS = [
  { game: 1, ply: 115, band: 'late' }, { game: 3, ply: 55, band: 'middle' },
  { game: 4, ply: 89, band: 'late' }, { game: 1, ply: 93, band: 'late' },
] as const;
export type PostRootSample = {
  type: 'sample'; positionId: string; phase: 'warmup' | 'measurement'; run: number; probe: boolean;
  apiElapsedMilliseconds: number; callElapsedMilliseconds: number;
  resultSource: string; completedDepth: number; timedOut: boolean; action: unknown;
  diagnostics: null | { startedAt: number; phases: SearchDiagnostics['phases']; finished: NonNullable<SearchDiagnostics['finished']>;
    depthOne: DepthOneDiagnostic | null; deadline: DeadlineObservation | null;
    interruptedPhase: SearchDiagnostics['interruptedPhase'] };
};
export const median = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : null;
};
export function summarize(samples: PostRootSample[]) {
  return TARGETS.map(target => {
    const id = `g${target.game}-p${target.ply}`;
    const rows = samples.filter(row => row.positionId === id && row.phase === 'measurement');
    const off = rows.filter(row => !row.probe);
    const on = rows.filter(row => row.probe);
    const durations = (name: keyof SearchDiagnostics['phases']) =>
      median(on.map(row => row.diagnostics!.depthOne!.postRootPhases![name]));
    return { positionId: id, offSamples: off.length, offApiMedianMilliseconds: median(off.map(row => row.apiElapsedMilliseconds)),
      offCallMedianMilliseconds: median(off.map(row => row.callElapsedMilliseconds)),
      offFallback: off.filter(row => row.resultSource === 'fallback').length,
      offDepths: off.map(row => row.completedDepth),
      offActions: off.map(row => row.action),
      onSamples: on.length, rootCandidates: on[0]?.diagnostics?.depthOne?.rootCandidates ?? null,
      onRootMedianMilliseconds: median(on.map(row => row.diagnostics!.phases['root-legal'].maxMilliseconds ?? 0)),
      onRootMaxMilliseconds: Math.max(0, ...on.map(row => row.diagnostics!.phases['root-legal'].maxMilliseconds ?? 0)),
      completedCandidates: on.map(row => row.diagnostics!.depthOne!.completedCandidates),
      currentCandidates: on.map(row => row.diagnostics!.depthOne!.currentCandidate),
      visitedNodes: on.map(row => row.diagnostics!.depthOne!.visitedNodes),
      quiescenceCalls: on.map(row => row.diagnostics!.depthOne!.quiescenceCalls),
      postRootMedianMilliseconds: median(on.map(row => row.diagnostics!.depthOne!.postRootMilliseconds!)),
      executeMedianMilliseconds: durations('normal-execute'),
      legalMedianMilliseconds: median(on.map(row =>
        row.diagnostics!.depthOne!.postRootPhases!['normal-legal'] + row.diagnostics!.depthOne!.postRootPhases!['q-legal'])),
      evaluationMedianMilliseconds: median(on.map(row =>
        row.diagnostics!.depthOne!.postRootPhases!['normal-evaluate'] + row.diagnostics!.depthOne!.postRootPhases!['q-evaluate'])),
      quiescenceMedianMilliseconds: durations('quiescence'),
      qLegalMedianMilliseconds: durations('q-legal'),
      qEvaluateMedianMilliseconds: durations('q-evaluate'),
      checkGapMedianMilliseconds: median(on.map(row => row.diagnostics!.deadline?.milliseconds ?? 0)),
      checkGapMaxMilliseconds: Math.max(0, ...on.map(row => row.diagnostics!.deadline?.milliseconds ?? 0)),
      deadlineActivitiesMilliseconds: Object.fromEntries([...new Set(on.flatMap(row =>
        Object.keys(row.diagnostics!.deadline?.activities ?? {})))].map(name => [name, on.reduce((sum, row) =>
        sum + (row.diagnostics!.deadline?.activities[name as keyof NonNullable<SearchDiagnostics['deadlineObservation']>['activities']] ?? 0), 0)])),
      interruptedStages: on.map(row => row.diagnostics!.depthOne!.interruptedStage) };
  });
}
