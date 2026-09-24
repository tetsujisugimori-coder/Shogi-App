/** Optional, aggregate-only probe for the two quiescence own-check call sites. */
export type CheckStage = 'check' | 'king' | 'attackSearch' | 'piece' | 'pattern' | 'step' | 'ray';
export type CheckOrigin = 'board' | 'drop';
export interface CheckTiming { calls: number; inclusiveMilliseconds: number; exclusiveMilliseconds: number; maxMilliseconds: number }

const stages: readonly CheckStage[] = ['check', 'king', 'attackSearch', 'piece', 'pattern', 'step', 'ray'];

export class CheckInternalsProbe {
  readonly timing: Record<CheckStage, CheckTiming> = Object.fromEntries(stages.map(stage =>
    [stage, { calls: 0, inclusiveMilliseconds: 0, exclusiveMilliseconds: 0, maxMilliseconds: 0 }])) as Record<CheckStage, CheckTiming>;
  checks = 0;
  attackScans = 0;
  scannedSquares = 0;
  opponentPieces = 0;
  pieceCalls = 0;

  record(stage: CheckStage, duration: number): void {
    const row = this.timing[stage];
    row.calls++;
    row.inclusiveMilliseconds += duration;
    if (duration > row.maxMilliseconds) row.maxMilliseconds = duration;
  }

  snapshot() {
    const timing = Object.fromEntries(stages.map(stage => [stage, { ...this.timing[stage] }])) as Record<CheckStage, CheckTiming>;
    timing.check.exclusiveMilliseconds = Math.max(0, timing.check.inclusiveMilliseconds - timing.king.inclusiveMilliseconds - timing.attackSearch.inclusiveMilliseconds);
    timing.attackSearch.exclusiveMilliseconds = Math.max(0, timing.attackSearch.inclusiveMilliseconds - timing.piece.inclusiveMilliseconds);
    timing.piece.exclusiveMilliseconds = Math.max(0, timing.piece.inclusiveMilliseconds - timing.pattern.inclusiveMilliseconds - timing.step.inclusiveMilliseconds - timing.ray.inclusiveMilliseconds);
    for (const stage of ['king', 'pattern', 'step', 'ray'] as const)
      timing[stage].exclusiveMilliseconds = timing[stage].inclusiveMilliseconds;
    return { timing, checks: this.checks, attackScans: this.attackScans,
      scannedSquares: this.scannedSquares, opponentPieces: this.opponentPieces, pieceCalls: this.pieceCalls };
  }
}
