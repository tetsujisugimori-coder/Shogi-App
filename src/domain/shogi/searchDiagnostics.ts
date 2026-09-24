import type { PieceType } from '../../types/shogi';
import { CheckInternalsProbe } from './checkInternalsDiagnostics';

/** Optional, synchronous search probe. Time is exclusive of nested spans. */
export type SearchDiagnosticPhase =
  | 'root-legal' | 'normal-legal' | 'normal-order' | 'see' | 'normal-execute'
  | 'normal-other' | 'normal-evaluate' | 'quiescence' | 'root-piece-moves' | 'root-hand-drops'
  | 'q-evaluate' | 'q-check' | 'q-legal' | 'q-order' | 'q-execute'
  | 'q-board-moves' | 'q-board-pseudo' | 'q-board-simulate' | 'q-board-own-check'
  | 'q-hand-drops' | 'q-drop-board-setup' | 'q-drop-own-check' | 'q-drop-pawn-mate';

export interface SearchDiagnosticEntry { calls: number; milliseconds: number; maxMilliseconds?: number; inclusiveMilliseconds?: number }
export interface QLegalCounts {
  boardSources: number; boardPseudo: number; boardLegal: number; boardActions: number;
  dropTypes: number; dropCandidates: number; dropLegal: number; dropActions: number;
  actions: number;
}
export type SearchDiagnosticActivity = SearchDiagnosticPhase | 'api-other';
export interface DepthOneDiagnostic {
  rootGeneratedAt: number;
  finishedAt: number | null;
  status: 'pending' | 'completed' | 'interrupted';
  rootCandidates: number;
  completedCandidates: number;
  currentCandidate: number | null;
  visitedNodes: number;
  quiescenceCalls: number;
  interruptedStage: string | null;
  postRootMilliseconds: number | null;
  /** Exclusive durations from root generation through depth-one completion/interruption. */
  postRootPhases: Record<SearchDiagnosticPhase, number> | null;
  postRootOtherMilliseconds: number | null;
}
export interface DeadlineObservation {
  deadlineAt: number;
  checkedAt: number;
  milliseconds: number;
  /** Exclusive work between the deadline and its first subsequent check. */
  activities: Partial<Record<SearchDiagnosticActivity, number>>;
}

export type DropStage = 'drop-board-setup' | 'own-check' | 'pawn-drop-mate';
export type DropPieceType = Exclude<PieceType, 'king'>;
export interface RootDropEntry {
  calls: number; milliseconds: number; maxMilliseconds: number;
  candidates: number; legal: number; rejected: Record<string, number>;
  stages: Record<DropStage, SearchDiagnosticEntry>;
}

const dropEntry = (): RootDropEntry => ({ calls: 0, milliseconds: 0, maxMilliseconds: 0,
  candidates: 0, legal: 0, rejected: {},
  stages: { 'drop-board-setup': { calls: 0, milliseconds: 0 },
    'own-check': { calls: 0, milliseconds: 0 }, 'pawn-drop-mate': { calls: 0, milliseconds: 0 } } });

export class SearchDiagnostics {
  readonly qLegalCounts: QLegalCounts = { boardSources: 0, boardPseudo: 0, boardLegal: 0,
    boardActions: 0, dropTypes: 0, dropCandidates: 0, dropLegal: 0, dropActions: 0, actions: 0 };
  readonly rootDrops: Record<DropPieceType, RootDropEntry> = {
    rook: dropEntry(), bishop: dropEntry(), gold: dropEntry(), silver: dropEntry(),
    knight: dropEntry(), lance: dropEntry(), pawn: dropEntry(),
  };
  readonly checkInternals: { board: CheckInternalsProbe; drop: CheckInternalsProbe } | null;
  constructor(readonly rootDropStageTiming = false, readonly rootBreakdown = true,
    checkInternals = false) {
    this.checkInternals = checkInternals
      ? { board: new CheckInternalsProbe(), drop: new CheckInternalsProbe() } : null;
  }

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
    'normal-evaluate': { calls: 0, milliseconds: 0 },
    quiescence: { calls: 0, milliseconds: 0 },
    'root-piece-moves': { calls: 0, milliseconds: 0 },
    'root-hand-drops': { calls: 0, milliseconds: 0 },
    'q-evaluate': { calls: 0, milliseconds: 0 },
    'q-check': { calls: 0, milliseconds: 0 },
    'q-legal': { calls: 0, milliseconds: 0 },
    'q-order': { calls: 0, milliseconds: 0 },
    'q-execute': { calls: 0, milliseconds: 0 },
    'q-board-moves': { calls: 0, milliseconds: 0 },
    'q-board-pseudo': { calls: 0, milliseconds: 0 },
    'q-board-simulate': { calls: 0, milliseconds: 0 },
    'q-board-own-check': { calls: 0, milliseconds: 0 },
    'q-hand-drops': { calls: 0, milliseconds: 0 },
    'q-drop-board-setup': { calls: 0, milliseconds: 0 },
    'q-drop-own-check': { calls: 0, milliseconds: 0 },
    'q-drop-pawn-mate': { calls: 0, milliseconds: 0 },
  };
  interruptedPhase: SearchDiagnosticPhase | 'api-other' | null = null;
  interruptedStage: string | null = null;
  private stage = 'before-depth-one';
  crossedDeadlinePhase: SearchDiagnosticPhase | 'api-other' | null = null;
  depthOne: DepthOneDiagnostic | null = null;
  deadlineObservation: DeadlineObservation | null = null;
  private deadlineActivities: Partial<Record<SearchDiagnosticActivity, number>> = {};
  private rootPhaseSnapshot: Record<SearchDiagnosticPhase, number> | null = null;
  private stack: SearchDiagnosticPhase[] = [];
  private last = 0;
  private start = 0;
  private limit = Number.POSITIVE_INFINITY;
  private clock: () => number = () => performance.now();
  now(): number { return this.clock(); }
  get startedAt(): number { return this.start; }
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
    this.account(now);
    if (this.deadlineObservation === null && Number.isFinite(this.limit) && now >= this.start + this.limit) {
      const deadlineAt = this.start + this.limit;
      this.deadlineObservation = { deadlineAt, checkedAt: now,
        milliseconds: Math.max(0, now - deadlineAt), activities: { ...this.deadlineActivities } };
    }
    const duration = Math.max(0, now - this.lastCheck);
    if (duration > this.longestCheckInterval.milliseconds)
      this.longestCheckInterval = { milliseconds: duration,
        phase: this.stack.at(-1) ?? this.longestSinceCheck.phase };
    this.lastCheck = now;
    this.longestSinceCheck = { milliseconds: 0, phase: 'api-other' };
  }

  private account(now: number): void {
    const active: SearchDiagnosticActivity = this.stack.at(-1) ?? 'api-other';
    if (active !== 'api-other') this.phases[active].milliseconds += Math.max(0, now - this.last);
    if (this.deadlineObservation === null && Number.isFinite(this.limit)) {
      const overlap = Math.max(0, now - Math.max(this.last, this.start + this.limit));
      if (overlap > 0) this.deadlineActivities[active] = (this.deadlineActivities[active] ?? 0) + overlap;
    }
    if (this.crossedDeadlinePhase === null && this.last - this.start < this.limit &&
      now - this.start >= this.limit) this.crossedDeadlinePhase = active;
    this.last = now;
  }

  rootGenerated(candidates: number): void {
    this.rootPhaseSnapshot = Object.fromEntries(Object.entries(this.phases).map(([key, entry]) =>
      [key, entry.milliseconds])) as Record<SearchDiagnosticPhase, number>;
    this.depthOne = { rootGeneratedAt: this.last, finishedAt: null, status: 'pending',
      rootCandidates: candidates, completedCandidates: 0, currentCandidate: null,
      visitedNodes: 0, quiescenceCalls: 0, interruptedStage: null,
      postRootMilliseconds: null, postRootPhases: null, postRootOtherMilliseconds: null };
  }

  candidateStarted(index: number): void {
    if (this.depthOne?.status === 'pending') this.depthOne.currentCandidate = index;
  }
  setStage(stage: string): void { this.stage = stage; }
  candidateCompleted(): void {
    if (this.depthOne?.status === 'pending') {
      this.depthOne.completedCandidates++;
      this.depthOne.currentCandidate = null;
    }
  }
  visitedNode(): void {
    if (this.depthOne?.status === 'pending') this.depthOne.visitedNodes++;
  }
  quiescenceEntered(): void {
    if (this.depthOne?.status === 'pending') this.depthOne.quiescenceCalls++;
  }
  endDepthOne(status: 'completed' | 'interrupted', stage: DepthOneDiagnostic['interruptedStage'] = null): void {
    const row = this.depthOne;
    if (!row || row.status !== 'pending' || !this.rootPhaseSnapshot) return;
    row.finishedAt = this.last;
    row.status = status;
    row.interruptedStage = stage;
    row.postRootMilliseconds = Math.max(0, this.last - row.rootGeneratedAt);
    row.postRootPhases = Object.fromEntries(Object.entries(this.phases).map(([key, entry]) =>
      [key, entry.milliseconds - this.rootPhaseSnapshot![key as SearchDiagnosticPhase]])) as Record<SearchDiagnosticPhase, number>;
    row.postRootOtherMilliseconds = Math.max(0, row.postRootMilliseconds -
      Object.values(row.postRootPhases).reduce((sum, value) => sum + value, 0));
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
      this.phases[phase].inclusiveMilliseconds = (this.phases[phase].inclusiveMilliseconds ?? 0) + duration;
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
    this.interruptedStage = this.stage;
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
