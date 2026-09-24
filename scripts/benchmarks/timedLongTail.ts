import type { SearchDiagnostics } from '../../src/domain/shogi/searchDiagnostics';

export interface LongTailSample {
  type: 'sample'; source: 'game' | 'replay'; id: string; gameId: string | null;
  ply: number; positionKeySha256: string; historyLength: number;
  probe: boolean; phase: 'warmup' | 'measurement'; run: number;
  resultSource: 'fallback' | 'completed-iteration'; completedDepth: number; timedOut: boolean;
  apiElapsedMilliseconds: number; callElapsedMilliseconds: number; excessMilliseconds: number;
  action: unknown; diagnostics: null | {
    phases: SearchDiagnostics['phases']; apiOtherMilliseconds: number; totalMilliseconds: number;
    crossedDeadlinePhase: SearchDiagnostics['crossedDeadlinePhase'];
    interruptedPhase: SearchDiagnostics['interruptedPhase'];
    longestCheckInterval: SearchDiagnostics['longestCheckInterval'];
    longestOperation: SearchDiagnostics['longestOperation'];
  };
  interval: { start: number; end: number };
  gc: { status: 'available' | 'unavailable'; reason: string | null;
    events: Array<{ start: number; duration: number; kind: number; flags: number; overlapsSearch: boolean }> };
  heap: { status: 'available' | 'unavailable'; reason: string | null;
    before: { at: number; bytes: number } | null; after: { at: number; bytes: number } | null };
}

const maxBy = <T>(rows: T[], value: (row: T) => number) =>
  rows.reduce<T | null>((best, row) => best === null || value(row) > value(best) ? row : best, null);

export function summarizeLongTail(samples: LongTailSample[]) {
  const rows = samples.filter(row => row.phase === 'measurement');
  const replay = rows.filter(row => row.source === 'replay');
  const pairs = replay.filter(row => row.probe).map(on => {
    const off = replay.find(row => !row.probe && row.id === on.id && row.run === on.run);
    if (!off) throw new Error(`Missing OFF pair: ${on.id}/${on.run}`);
    return { delta: on.callElapsedMilliseconds - off.callElapsedMilliseconds,
      actionChanged: JSON.stringify(on.action) !== JSON.stringify(off.action),
      depthChanged: on.completedDepth !== off.completedDepth };
  });
  const deltas = pairs.map(pair => pair.delta).sort((a, b) => a - b);
  const largest = maxBy(rows, row => row.excessMilliseconds);
  const checks = rows.filter(row => row.diagnostics);
  const longestCheck = maxBy(checks, row => row.diagnostics!.longestCheckInterval.milliseconds);
  const interior = checks.flatMap(row => Object.entries(row.diagnostics!.phases)
    .filter(([name]) => name.startsWith('root-') && name !== 'root-legal' || name.startsWith('q-'))
    .map(([phase, entry]) => ({ id: row.id, phase, milliseconds: entry.maxMilliseconds ?? 0, calls: entry.calls })));
  const longestInterior = maxBy(interior, row => row.milliseconds);
  const longestRootInterior = maxBy(interior.filter(row => row.phase.startsWith('root-')), row => row.milliseconds);
  const longestQuiescenceInterior = maxBy(interior.filter(row => row.phase.startsWith('q-')), row => row.milliseconds);
  return {
    samples: rows.length, games: new Set(rows.filter(row => row.source === 'game').map(row => row.gameId)).size,
    fallback: rows.filter(row => row.resultSource === 'fallback').length,
    over100: rows.filter(row => row.excessMilliseconds > 0).length,
    over105: rows.filter(row => row.excessMilliseconds > 5).length,
    maxExcess: largest && { id: largest.id, milliseconds: largest.excessMilliseconds },
    longestCheck: longestCheck && { id: longestCheck.id, ...longestCheck.diagnostics!.longestCheckInterval },
    longestInterior,
    longestRootInterior, longestQuiescenceInterior,
    gcEvents: rows.reduce((sum, row) => sum + row.gc.events.length, 0),
    gcOverlaps: rows.reduce((sum, row) => sum + row.gc.events.filter(event => event.overlapsSearch).length, 0),
    heapFirst: rows[0]?.heap.before ?? null, heapLast: rows.at(-1)?.heap.after ?? null,
    missingGc: rows.filter(row => row.gc.status === 'unavailable').length,
    missingHeap: rows.filter(row => row.heap.status === 'unavailable').length,
    probePairs: { count: pairs.length, medianDeltaMilliseconds: deltas[Math.floor((deltas.length - 1) / 2)] ?? null,
      minDeltaMilliseconds: deltas[0] ?? null, maxDeltaMilliseconds: deltas.at(-1) ?? null,
      actionChanged: pairs.filter(pair => pair.actionChanged).length,
      depthChanged: pairs.filter(pair => pair.depthChanged).length },
  };
}
