/** Coarse, opt-in inclusive spans. All clocks come from SearchDiagnostics.now. */
export type ValidationStage = 'execute-action' | 'execute-api' | 'validation' | 'pseudo' |
  'board-setup' | 'own-check' | 'pawn-drop-mate';
export type ValidationOrigin = 'generationBoard' | 'generationDrop' | 'executionBoard' | 'executionDrop';
export interface ValidationTiming { calls: number; inclusiveMilliseconds: number }
const stages: readonly ValidationStage[] = ['execute-action', 'execute-api', 'validation',
  'pseudo', 'board-setup', 'own-check', 'pawn-drop-mate'];

export class ActionValidationProbe {
  readonly timing = Object.fromEntries(stages.map(stage =>
    [stage, { calls: 0, inclusiveMilliseconds: 0 }])) as Record<ValidationStage, ValidationTiming>;
  constructor(private readonly clock: () => number) {}
  measure<T>(stage: ValidationStage, fn: () => T): T {
    const entry = this.timing[stage];
    entry.calls++;
    const start = this.clock();
    try { return fn(); }
    finally { entry.inclusiveMilliseconds += Math.max(0, this.clock() - start); }
  }
}

export class ActionValidationDiagnostics {
  readonly generationBoard: ActionValidationProbe;
  readonly generationDrop: ActionValidationProbe;
  readonly executionBoard: ActionValidationProbe;
  readonly executionDrop: ActionValidationProbe;
  constructor(clock: () => number) {
    this.generationBoard = new ActionValidationProbe(clock);
    this.generationDrop = new ActionValidationProbe(clock);
    this.executionBoard = new ActionValidationProbe(clock);
    this.executionDrop = new ActionValidationProbe(clock);
  }
  snapshot() {
    return Object.fromEntries((['generationBoard', 'generationDrop', 'executionBoard',
      'executionDrop'] as const).map(origin => [origin,
      structuredClone(this[origin].timing)])) as Record<ValidationOrigin, Record<ValidationStage, ValidationTiming>>;
  }
}
