import type { PieceType } from '../../types/shogi';

/** Optional, synchronous search probe. Time is exclusive of nested spans. */
export type SearchDiagnosticPhase =
  | 'root-legal' | 'normal-legal' | 'normal-order' | 'see' | 'normal-execute'
  | 'normal-other' | 'quiescence' | 'root-piece-moves' | 'root-hand-drops'
  | 'q-evaluate' | 'q-check' | 'q-legal' | 'q-order' | 'q-execute';

export interface SearchDiagnosticEntry { calls: number; milliseconds: number; maxMilliseconds?: number }

export type DropStage = 'board-clone' | 'own-check' | 'pawn-drop-mate';
export type DropPieceType = Exclude<PieceType, 'king'>;
export interface RootDropEntry {
  calls: number; milliseconds: number; maxMilliseconds: number;
  candidates: number; legal: number; rejected: Record<string, number>;
  stages: Record<DropStage, SearchDiagnosticEntry>;
}

const dropEntry = (): RootDropEntry => ({ calls: 0, milliseconds: 0, maxMilliseconds: 0,
  candidates: 0, legal: 0, rejected: {},
  stages: { 'board-clone': { calls: 0, milliseconds: 0 },
    'own-check': { calls: 0, milliseconds: 0 }, 'pawn-drop-mate': { calls: 0, milliseconds: 0 } } });

export class SearchDiagnostics {
  readonly rootDrops: Record<DropPieceType, RootDropEntry> = {
    rook: dropEntry(), bishop: dropEntry(), gold: dropEntry(), silver: dropEntry(),
    knight: dropEntry(), lance: dropEntry(), pawn: dropEntry(),
  };
  constructor(readonly rootDropStageTiming = false) {}

  recordDropResult(type: DropPieceType, reason?: string): void {
    const entry = this.rootDrops[type];
    entry.candidates++;
    if (reason) entry.rejected[reason] = (entry.rejected[reason] ?? 0) + 1;
    else entry.legal++;
  }

  measureDropStage<T>(type: DropPieceType, stage: DropStage, fn: () => T): T {
    const entry = this.rootDrops[type].stages[stage];
    entry.calls++;
    if (!this.rootDropStageTiming) return fn();
    const start = this.clock();
    try { return fn(); }
    finally {
      const duration = Math.max(0, this.clock() - start);
      entry.milliseconds += duration;
      entry.maxMilliseconds = Math.max(entry.maxMilliseconds ?? 0, duration);
    }
  }
  readonly phases: Record<SearchDiagnosticPhase, SearchDiagnosticEntry> = {
    'root-legal': { calls: 0, milliseconds: 0 },
    'normal-legal': { calls: 0, milliseconds: 0 },
    'normal-order': { calls: 0, milliseconds: 0 },
    see: { calls: 0, milliseconds: 0 },
    'normal-execute': { calls: 0, milliseconds: 0 },
    'normal-other': { calls: 0, milliseconds: 0 },
    quiescence: { calls: 0, milliseconds: 0 },
    'root-piece-moves': { calls: 0, milliseconds: 0 },
    'root-hand-drops': { calls: 0, milliseconds: 0 },
    'q-evaluate': { calls: 0, milliseconds: 0 },
    'q-check': { calls: 0, milliseconds: 0 },
    'q-legal': { calls: 0, milliseconds: 0 },
    'q-order': { calls: 0, milliseconds: 0 },
    'q-execute': { calls: 0, milliseconds: 0 },
  };
  interruptedPhase: SearchDiagnosticPhase | 'api-other' | null = null;
  crossedDeadlinePhase: SearchDiagnosticPhase | 'api-other' | null = null;
  private stack: SearchDiagnosticPhase[] = [];
  private last = 0;
  private start = 0;
  private limit = Number.POSITIVE_INFINITY;
  private clock: () => number = () => performance.now();
  now(): number { return this.clock(); }
  private lastCheck = 0;
  private longestSinceCheck = { milliseconds: 0, phase: 'api-other' as SearchDiagnosticPhase | 'api-other' };
  longestCheckInterval = { milliseconds: 0, phase: 'api-other' as SearchDiagnosticPhase | 'api-other' };
  longestOperation = { milliseconds: 0, phase: 'api-other' as SearchDiagnosticPhase | 'api-other' };
  finished: { apiOtherMilliseconds: number; totalMilliseconds: number } | null = null;

  begin(start: number, limit = Number.POSITIVE_INFINITY, clock: () => number = () => performance.now()): void {
    this.start = this.last = start;
    this.limit = limit;
    this.clock = clock;
    this.lastCheck = start;
  }

  checked(now: number): void {
    const duration = Math.max(0, now - this.lastCheck);
    if (duration > this.longestCheckInterval.milliseconds)
      this.longestCheckInterval = { milliseconds: duration,
        phase: this.stack.at(-1) ?? this.longestSinceCheck.phase };
    this.lastCheck = now;
    this.longestSinceCheck = { milliseconds: 0, phase: 'api-other' };
  }

  private account(now: number): void {
    const active = this.stack.at(-1);
    if (active) this.phases[active].milliseconds += Math.max(0, now - this.last);
    if (this.crossedDeadlinePhase === null && this.last - this.start < this.limit &&
      now - this.start >= this.limit) this.crossedDeadlinePhase = active ?? 'api-other';
    this.last = now;
  }

  measure<T>(phase: SearchDiagnosticPhase, fn: () => T): T {
    const began = this.clock();
    this.account(began);
    this.phases[phase].calls++;
    this.stack.push(phase);
    try { return fn(); }
    finally {
      const ended = this.clock();
      this.account(ended);
      const duration = Math.max(0, ended - began);
      this.phases[phase].maxMilliseconds = Math.max(this.phases[phase].maxMilliseconds ?? 0, duration);
      if (duration > this.longestOperation.milliseconds)
        this.longestOperation = { milliseconds: duration, phase };
      if (duration > this.longestSinceCheck.milliseconds)
        this.longestSinceCheck = { milliseconds: duration, phase };
      this.stack.pop();
    }
  }

  interrupted(): void {
    this.interruptedPhase = this.stack.at(-1) ?? 'api-other';
  }

  finish(now = this.clock()): { apiOtherMilliseconds: number; totalMilliseconds: number } {
    this.account(now);
    const totalMilliseconds = Math.max(0, now - this.start);
    const measured = Object.values(this.phases).reduce((sum, row) => sum + row.milliseconds, 0);
    return this.finished = { apiOtherMilliseconds: Math.max(0, totalMilliseconds - measured), totalMilliseconds };
  }
}

export function measured<T>(diagnostics: SearchDiagnostics | undefined,
  phase: SearchDiagnosticPhase, fn: () => T): T {
  return diagnostics ? diagnostics.measure(phase, fn) : fn();
}
