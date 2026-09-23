import type { BoardState, GameResult, Player } from '../../types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from './legalActions';
import { cloneBoardState } from './replay';
import { createPositionKey } from './repetition';
import { areLegalActionsEqual, type TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from './twoPlyAlphaBetaAi';

const statisticPairs = [
  ['visitedPositionCount', 'totalVisitedPositionCount'],
  ['cutoffCount', 'totalCutoffCount'],
  ['skippedActionCount', 'totalSkippedActionCount'],
  ['quiescenceLeafCount', 'totalQuiescenceLeafCount'],
  ['quiescenceVisitedPositionCount', 'totalQuiescenceVisitedPositionCount'],
  ['quiescenceCutoffCount', 'totalQuiescenceCutoffCount'],
  ['quiescenceSkippedActionCount', 'totalQuiescenceSkippedActionCount'],
] as const;
type StatisticKey = typeof statisticPairs[number][number];
type ObservationKey = StatisticKey | 'selectedEvaluation' | 'completedDepth' |
  'elapsedMilliseconds' | 'timedOut' | 'principalVariation' | 'evaluationBreakdown';

/** Existing timed alpha-beta results are assignable directly. Other synchronous
 * searches explicitly report unavailable observations as null, never as zero.
 * Scores and evaluation breakdowns use the moving player's perspective.
 */
export type SelfPlaySearchResult = Pick<TimeLimitedIterativeDeepeningAlphaBetaSearchResult, 'selectedAction'> & {
  [K in ObservationKey]: TimeLimitedIterativeDeepeningAlphaBetaSearchResult[K] | null;
} & { resultSource?: TimeLimitedIterativeDeepeningAlphaBetaSearchResult['resultSource'] };

export interface SelfPlayParticipant<Settings> {
  settings: Settings;
  /** Receives an independent, recursively protected BoardState on every ply.
   * Use cloneBoardState to obtain a mutable working copy if needed. */
  search: (state: BoardState, settings: Settings) => SelfPlaySearchResult;
}

export type SelfPlayPlyRecord = Omit<SelfPlaySearchResult, 'selectedAction'> & {
  ply: number;
  player: Player;
  positionKey: string;
  action: LegalAction;
};

export interface SelfPlayFailure {
  /** 1-based attempted ply; invalid options fail before ply 1 can start. */
  ply: number;
  player: Player;
  stage: 'options' | 'position' | 'search' | 'result' | 'apply';
  code: 'invalid_max_plies' | 'invalid_position' | 'input_mutation' |
    'search_exception' | 'invalid_result' | 'missing_action' | 'wrong_player' |
    'illegal_action' | 'application_failed';
  message: string;
}

interface SelfPlayGameRecord {
  plies: SelfPlayPlyRecord[];
  finalState: BoardState;
}

export type SelfPlayGameResult = SelfPlayGameRecord & (
  | { status: 'ended'; gameResult: GameResult }
  | { status: 'max_plies' }
  | { status: 'failed'; failure: SelfPlayFailure }
);

/** Frozen proxy children also protect access through property descriptors.
 * Traps remember attempted writes even when the search catches the exception. */
function protectSearchInput(state: BoardState) {
  let attemptedMutation = false;
  const reject = (): never => {
    attemptedMutation = true;
    throw new TypeError('Self-play search input must not be mutated.');
  };
  const protect = (value: object): object => {
    for (const [key, child] of Object.entries(value)) {
      if (child !== null && typeof child === 'object') {
        (value as Record<string, unknown>)[key] = protect(child);
      }
    }
    return new Proxy(Object.freeze(value), {
      set: reject, deleteProperty: reject, defineProperty: reject,
      setPrototypeOf: reject, preventExtensions: reject,
    });
  };
  return {
    snapshot: protect(cloneBoardState(state)) as BoardState,
    wasMutated: () => attemptedMutation,
  };
}

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const score = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value);

function cloneAction(action: LegalAction): LegalAction {
  return action.kind === 'move'
    ? { ...action, from: { ...action.from }, to: { ...action.to } }
    : { ...action, to: { ...action.to } };
}

/** Shape-check before calling the existing semantic action comparator. */
function isAction(value: unknown): value is LegalAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as LegalAction;
  const coordinate = (v: LegalAction['to']) => v && count(v.row) && v.row < 9 && count(v.col) && v.col < 9;
  return (action.player === 'sente' || action.player === 'gote') &&
    ['king', 'rook', 'bishop', 'gold', 'silver', 'knight', 'lance', 'pawn'].includes(action.pieceType) &&
    !!coordinate(action.to) && (action.kind === 'move'
      ? !!coordinate(action.from) && ['none', 'promote', 'decline'].includes(action.promotion)
      : action.kind === 'drop' && typeof action.pieceId === 'string' && action.promotion === 'none');
}

function validateObservations(state: BoardState, result: SelfPlaySearchResult): void {
  const invalid = (field: string): never => { throw new TypeError(`Invalid self-play search result: ${field}.`); };
  if (result.resultSource !== undefined && result.resultSource !== 'fallback' &&
    result.resultSource !== 'completed-iteration') invalid('resultSource');
  if (result.resultSource === 'fallback' && (result.completedDepth !== 0 || !result.timedOut ||
    result.selectedEvaluation !== null || result.evaluationBreakdown !== null ||
    result.principalVariation?.length !== 0 || statisticPairs.some(([key, total]) =>
      result[key] !== 0 || result[total] !== 0))) invalid('fallback');
  if (result.selectedEvaluation !== null && !score(result.selectedEvaluation)) invalid('selectedEvaluation');
  if (result.completedDepth !== null && !count(result.completedDepth)) invalid('completedDepth');
  if (result.elapsedMilliseconds !== null &&
    (typeof result.elapsedMilliseconds !== 'number' || !Number.isFinite(result.elapsedMilliseconds) || result.elapsedMilliseconds < 0)) invalid('elapsedMilliseconds');
  if (result.timedOut !== null && typeof result.timedOut !== 'boolean') invalid('timedOut');
  for (const [key, total] of statisticPairs) {
    if ((result[key] !== null && !count(result[key])) || (result[total] !== null && !count(result[total])) ||
      (result[key] !== null && result[total] !== null && result[total]! < result[key]!)) invalid(key);
  }
  const breakdown = result.evaluationBreakdown;
  if (breakdown !== null) {
    if (!breakdown || typeof breakdown !== 'object') invalid('evaluationBreakdown');
    const { total, material, pieceSquare, kingSafety, undefendedPieceSafety, terminal } = breakdown;
    if (!score(total) || (result.selectedEvaluation !== null && total !== result.selectedEvaluation) ||
      ![material, pieceSquare, kingSafety, undefendedPieceSafety].every((v) => typeof v === 'number' && Number.isFinite(v))) invalid('evaluationBreakdown');
    if (terminal === null) {
      if (!Number.isFinite(total) || total !== material + pieceSquare + kingSafety + undefendedPieceSafety) invalid('evaluationBreakdown.total');
    } else if (!['win', 'loss', 'draw'].includes(terminal) ||
      total !== (terminal === 'win' ? Infinity : terminal === 'loss' ? -Infinity : 0) ||
      [material, pieceSquare, kingSafety, undefendedPieceSafety].some((v) => v !== 0)) invalid('evaluationBreakdown.terminal');
  }
  const pv = result.principalVariation;
  if (result.resultSource === 'fallback') return;
  if (pv === null) return;
  if (!Array.isArray(pv) || pv.length === 0 || !pv.every(isAction) ||
    !areLegalActionsEqual(pv[0], result.selectedAction!)) invalid('principalVariation');
  let replay = cloneBoardState(state);
  for (const action of pv) {
    const legal = getLegalActions(replay).find((candidate) => areLegalActionsEqual(candidate, action));
    if (!legal) invalid('principalVariation legality');
    const execution = executeLegalAction(replay, legal!, { proposer: 'local_ai' });
    if (execution.type !== 'applied') invalid('principalVariation application');
    else replay = execution.state;
  }
  if (breakdown !== null) {
    const terminal = replay.status !== 'ended' ? null : replay.result?.winner === null
      ? 'draw' : replay.result?.winner === state.turn ? 'win' : 'loss';
    if (breakdown.terminal !== terminal) invalid('principalVariation terminal');
  }
}

/** Runs one synchronous research game. No UI, clock, randomness, persistence,
 * automatic declarations/resignation, or rule adjudication is owned here.
 * maxPlies is relative to this call, independently of the game's moveNumber.
 * The injected functions/settings determine reproducibility and search timing.
 */
export function runSelfPlayGame<SenteSettings, GoteSettings>(options: {
  initialState: BoardState;
  sente: SelfPlayParticipant<SenteSettings>;
  gote: SelfPlayParticipant<GoteSettings>;
  maxPlies: number;
}): SelfPlayGameResult {
  let state = cloneBoardState(options.initialState);
  const plies: SelfPlayPlyRecord[] = [];
  const fail = (stage: SelfPlayFailure['stage'], code: SelfPlayFailure['code'], message: string): SelfPlayGameResult => ({
    status: 'failed', finalState: cloneBoardState(state), plies,
    failure: { ply: plies.length + 1, player: state.turn, stage, code, message },
  });
  if (!Number.isFinite(options.maxPlies) || !Number.isInteger(options.maxPlies) || options.maxPlies < 0) {
    return fail('options', 'invalid_max_plies', 'maxPlies must be a finite non-negative integer.');
  }
  for (;;) {
    if (state.status === 'ended') {
      if (!state.result) return fail('position', 'invalid_position', 'Ended position has no GameResult.');
      return { status: 'ended', gameResult: { ...state.result }, finalState: cloneBoardState(state), plies };
    }
    if (state.result) return fail('position', 'invalid_position', 'Non-ended position has a GameResult.');
    if (plies.length === options.maxPlies) return { status: 'max_plies', finalState: cloneBoardState(state), plies };
    const input = protectSearchInput(state);
    let result: SelfPlaySearchResult;
    try {
      result = state.turn === 'sente'
        ? options.sente.search(input.snapshot, options.sente.settings)
        : options.gote.search(input.snapshot, options.gote.settings);
    } catch (error) {
      return fail('search', input.wasMutated() ? 'input_mutation' : 'search_exception',
        error instanceof Error ? error.message : String(error));
    }
    if (input.wasMutated()) return fail('search', 'input_mutation', 'Search attempted to mutate its input.');
    let action: LegalAction;
    let record: SelfPlayPlyRecord;
    try {
      if (!result || typeof result !== 'object') return fail('result', 'invalid_result', 'Search must return an observation object.');
      if (result.selectedAction === null) return fail('result', 'missing_action', 'Non-ended position requires a selected action.');
      if (!isAction(result.selectedAction)) return fail('result', 'invalid_result', 'Malformed selected action.');
      if (result.selectedAction.player !== state.turn) return fail('result', 'wrong_player', 'Selected action does not match the current turn.');
      const legal = getLegalActions(state).find((candidate) => areLegalActionsEqual(candidate, result.selectedAction!));
      if (!legal) return fail('result', 'illegal_action', 'Selected action is not a legal candidate.');
      action = cloneAction(legal);
      validateObservations(state, result);
      const statistics = Object.fromEntries(statisticPairs.flatMap((pair) => pair.map((key) => [key, result[key]]))) as Pick<SelfPlaySearchResult, StatisticKey>;
      record = {
        ply: plies.length + 1, player: state.turn, positionKey: createPositionKey(state), action: cloneAction(action),
        selectedEvaluation: result.selectedEvaluation, completedDepth: result.completedDepth,
        elapsedMilliseconds: result.elapsedMilliseconds, timedOut: result.timedOut, ...statistics,
        principalVariation: result.principalVariation?.map(cloneAction) ?? null,
        evaluationBreakdown: result.evaluationBreakdown === null ? null : { ...result.evaluationBreakdown },
        ...(result.resultSource === undefined ? {} : { resultSource: result.resultSource }),
      };
    } catch (error) {
      return fail('result', 'invalid_result', error instanceof Error ? error.message : String(error));
    }
    try {
      const execution = executeLegalAction(cloneBoardState(state), action, { proposer: 'local_ai' });
      if (execution.type !== 'applied') return fail('apply', 'application_failed', `Legal action execution returned ${execution.type}.`);
      state = execution.state;
      plies.push(record);
    } catch (error) {
      return fail('apply', 'application_failed', error instanceof Error ? error.message : String(error));
    }
  }
}
