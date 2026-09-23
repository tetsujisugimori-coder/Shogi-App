/** Optional, synchronous search probe. Time is exclusive of nested spans. */
export type SearchDiagnosticPhase =
  | 'root-legal' | 'normal-legal' | 'normal-order' | 'see' | 'normal-execute'
  | 'normal-other' | 'quiescence';

export interface SearchDiagnosticEntry { calls: number; milliseconds: number }

export class SearchDiagnostics {
  readonly phases: Record<SearchDiagnosticPhase, SearchDiagnosticEntry> = {
    'root-legal': { calls: 0, milliseconds: 0 },
    'normal-legal': { calls: 0, milliseconds: 0 },
    'normal-order': { calls: 0, milliseconds: 0 },
    see: { calls: 0, milliseconds: 0 },
    'normal-execute': { calls: 0, milliseconds: 0 },
    'normal-other': { calls: 0, milliseconds: 0 },
    quiescence: { calls: 0, milliseconds: 0 },
  };
  interruptedPhase: SearchDiagnosticPhase | 'api-other' | null = null;
  crossedDeadlinePhase: SearchDiagnosticPhase | 'api-other' | null = null;
  private stack: SearchDiagnosticPhase[] = [];
  private last = 0;
  private start = 0;
  private limit = Number.POSITIVE_INFINITY;

  begin(start: number, limit = Number.POSITIVE_INFINITY): void {
    this.start = this.last = start;
    this.limit = limit;
  }

  private account(now: number): void {
    const active = this.stack.at(-1);
    if (active) this.phases[active].milliseconds += Math.max(0, now - this.last);
    if (this.crossedDeadlinePhase === null && this.last - this.start < this.limit &&
      now - this.start >= this.limit) this.crossedDeadlinePhase = active ?? 'api-other';
    this.last = now;
  }

  measure<T>(phase: SearchDiagnosticPhase, fn: () => T): T {
    this.account(performance.now());
    this.phases[phase].calls++;
    this.stack.push(phase);
    try { return fn(); }
    finally {
      this.account(performance.now());
      this.stack.pop();
    }
  }

  interrupted(): void {
    this.interruptedPhase = this.stack.at(-1) ?? 'api-other';
  }

  finish(now = performance.now()): { apiOtherMilliseconds: number; totalMilliseconds: number } {
    this.account(now);
    const totalMilliseconds = Math.max(0, now - this.start);
    const measured = Object.values(this.phases).reduce((sum, row) => sum + row.milliseconds, 0);
    return { apiOtherMilliseconds: Math.max(0, totalMilliseconds - measured), totalMilliseconds };
  }
}

export function measured<T>(diagnostics: SearchDiagnostics | undefined,
  phase: SearchDiagnosticPhase, fn: () => T): T {
  return diagnostics ? diagnostics.measure(phase, fn) : fn();
}
