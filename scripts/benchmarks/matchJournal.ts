import assert from 'node:assert/strict';
import type { BoardState, Player, GameResult } from '../../src/types/shogi';
import { cloneBoardState, createPositionSnapshot, restoreBoardStateAtHistoryIndex } from '../../src/domain/shogi/replay';
import { getLegalActions, executeLegalAction, type LegalAction } from '../../src/domain/shogi/legalActions';
import { runSelfPlayGame, type SelfPlaySearchResult } from '../../src/domain/shogi/selfPlayGame';
import { areLegalActionsEqual, type AlphaBetaSearchOptions } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { evaluateSearchPositionBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { validatePosition } from './tacticalDiagnostics';
import { CapacityError, JournalWriter, readJournal, valueHash, canonical, encode } from './journalIO';

export type Mode = 'legacy' | 'experimental';
export interface Conditions {
  timeMs: number; depth: number; options: AlphaBetaSearchOptions;
  maxPlies: number; gameMs: number; hardGameMs: number; runMs: number;
  maxBytes: number; reserveBytes: number; stopAfter: number | null;
}
export interface StartRecord {
  type: 'start'; runId: string; pairId: string; gameId: string;
  sourceSha: string; sourceHashes: Record<string, string>;
  seats: Record<Player, Mode>; initialState: BoardState; conditions: Conditions;
  startedAt: string; environment: { node: string; platform: string; arch: string; cpu: string };
}
export interface MoveRecord {
  type: 'move'; ply: number; moveNumber: number; player: Player; action: LegalAction;
  search: SelfPlaySearchResult; apiMs: number; afterHash: string;
}
export type EndReason = 'rule' | 'max_plies' | 'time_limit' | 'interrupted' | 'capacity' | 'search_failure';
export interface EndRecord {
  type: 'end'; reason: EndReason; plies: number; finalHash: string; gameResult: GameResult | null;
  apiMs: number; uncommittedApiMs: number; saveMsBeforeEnd: number; wallMsBeforeEnd: number; endedAt: string;
  detail: string | null; finalSearch: SelfPlaySearchResult | null;
}
export type JournalRecord = StartRecord | MoveRecord | EndRecord;
export const stateHash = (state: BoardState) => valueHash(cloneBoardState(state));
/** Archived JSON omitted optional undefined Piece.isPromoted; permit ONLY that provenance difference.
 * Journal payloads, search values and post-move state hashes remain fully lossless. */
function initialProvenanceHash(state: BoardState) {
  const copy=cloneBoardState(state);
  for (const position of [copy,...(copy.positionSnapshots??[])]) {
    const pieces=[...position.squares.flatMap(row=>row.flatMap(square=>square.piece?[square.piece]:[])),...position.senteHand,...position.goteHand];
    for (const piece of pieces) if(piece.isPromoted===undefined)delete piece.isPromoted;
  }
  return stateHash(copy);
}
const count = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const duration = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

function keys(value: object, expected: string[]) {
  assert.deepEqual(Object.keys(value).sort(), expected.sort(), 'record fields');
}
export function validateStart(start: StartRecord): void {
  keys(start, ['type','runId','pairId','gameId','sourceSha','sourceHashes','seats','initialState','conditions','startedAt','environment']);
  assert.equal(start.type, 'start');
  for (const id of [start.runId, start.pairId, start.gameId]) assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/);
  assert.match(start.sourceSha, /^[a-f0-9]{40}$/);
  assert.ok(Object.keys(start.sourceHashes).length > 0);
  for (const h of Object.values(start.sourceHashes)) assert.match(h, /^[a-f0-9]{64}$/);
  keys(start.seats, ['sente','gote']);
  assert.deepEqual(Object.values(start.seats).sort(), ['experimental','legacy']);
  assert.ok(Number.isFinite(Date.parse(start.startedAt)));
  keys(start.environment, ['node','platform','arch','cpu']);
  assert.ok(Object.values(start.environment).every(v => typeof v === 'string' && v.length > 0));
  const c = start.conditions;
  keys(c, ['timeMs','depth','options','maxPlies','gameMs','hardGameMs','runMs','maxBytes','reserveBytes','stopAfter']);
  for (const v of [c.timeMs,c.depth,c.maxPlies,c.gameMs,c.hardGameMs,c.runMs,c.maxBytes,c.reserveBytes]) assert.ok(count(v));
  assert.ok(c.depth >= 1 && c.depth <= 16 && c.maxPlies <= 1000 && c.maxBytes > c.reserveBytes && c.reserveBytes >= 1024);
  assert.ok(c.hardGameMs > c.gameMs && c.runMs >= c.hardGameMs);
  assert.ok(c.stopAfter === null || count(c.stopAfter) && c.stopAfter <= c.maxPlies);
  // This schema describes precisely the PR214 experiment, not arbitrary engine option objects.
  assert.deepEqual(c.options, {
    moveOrdering: 'standard', killerMoves: false, usePreviousIterationPv: false, useTranspositionTable: false,
    quiescence: { maxTacticalDepth: 1, moveOrdering: 'original', includeQuietPromotions: false, maxCheckEvasionExtensions: 0 },
  });
  validateInitialHistory(start.initialState);
}

/** All supplied repetition/check history must have a complete legal provenance from snapshot 0. */
export function validateInitialHistory(state: BoardState): void {
  const validate = (s: BoardState) => validatePosition({ id: 'journal-initial', origin: 'saved snapshot baseline', purpose: 'journal history',
    state: s, referenceWinner: s.turn, referenceDepth: 1, expectation: 'avoid-loss' });
  validate(state);
  assert.equal(state.moveNumber, state.history.length + 1);
  assert.equal(state.positionHistory?.length, state.history.length + 1);
  assert.equal(state.positionSnapshots?.length, state.history.length + 1);
  let replay = restoreBoardStateAtHistoryIndex(state, 0);
  assert.ok(replay, 'missing initial snapshot');
  validate(replay);
  assert.deepEqual(cloneBoardState(replay).positionSnapshots?.[0], createPositionSnapshot(replay), 'initial snapshot mismatch');
  assert.equal(replay.positionHistory?.[0].historyIndex, 0);
  assert.equal(replay.positionHistory?.[0].movedBy, null);
  assert.equal(replay.positionHistory?.[0].gaveCheck, false);
  for (const move of state.history) {
    const action = getLegalActions(replay).find(a => a.kind === move.kind && a.player === move.player && a.pieceType === move.pieceType &&
      a.promotion === move.promotion && a.to.row === move.to.row && a.to.col === move.to.col &&
      (a.kind === 'move' ? move.kind === 'move' && a.from.row === move.from.row && a.from.col === move.from.col
        : move.kind === 'drop' && a.pieceId === move.pieceId));
    assert.ok(action, 'illegal initial history');
    const next = executeLegalAction(replay, action, { proposer: 'local_ai' });
    assert.equal(next.type, 'applied');
    if (next.type === 'applied') replay = next.state;
  }
  assert.equal(initialProvenanceHash(replay), initialProvenanceHash(state), 'initial history/state mismatch');
}

export type Search = (state: BoardState, mode: Mode) => SelfPlaySearchResult;
export function onePly(state: BoardState, search: (state: BoardState) => SelfPlaySearchResult) {
  const participant = { settings: undefined, search };
  return runSelfPlayGame({ initialState: state, sente: participant, gote: participant, maxPlies: 1 });
}

/** No new rules: the existing protected self-play runner owns each search/validation/application. */
export function runJournalGame(start: StartRecord, writer: JournalWriter, search: Search, clock = () => performance.now(), onCommit?: (ply: number) => void) {
  validateStart(start);
  const began = clock();
  let state = cloneBoardState(start.initialState), plies = 0, apiMs = 0;
  writer.append(start);
  const end = (reason: EndReason, detail: string | null = null, finalSearch: SelfPlaySearchResult | null = null, uncommittedApiMs = 0) => {
    const record: EndRecord = { type: 'end', reason, plies, finalHash: stateHash(state), gameResult: state.result ?? null,
      apiMs, uncommittedApiMs, saveMsBeforeEnd: writer.saveMs, wallMsBeforeEnd: clock() - began, endedAt: new Date().toISOString(), detail, finalSearch };
    writer.append(record, true);
    return { end: record, finalState: state, saveMs: writer.saveMs, wallMs: clock() - began, bytes: writer.bytes };
  };
  for (;;) {
    if (state.status === 'ended') return end('rule');
    if (plies === start.conditions.maxPlies) return end('max_plies');
    if (clock() - began >= start.conditions.gameMs) return end('time_limit');
    if (start.conditions.stopAfter !== null && plies >= start.conditions.stopAfter) return end('interrupted');
    let observed: SelfPlaySearchResult | null = null, elapsed = 0;
    const next = onePly(state, s => {
      const before = clock();
      try { observed = search(s, start.seats[s.turn]); return observed; }
      finally { elapsed = clock() - before; }
    });
    if (next.status === 'failed') return end('search_failure', JSON.stringify(next.failure), observed, elapsed);
    if (next.plies.length === 0) {
      assert.equal(next.status, 'ended'); state = next.finalState;
      return end('rule', null, observed, elapsed);
    }
    assert.ok(observed);
    const record: MoveRecord = { type: 'move', ply: plies + 1, moveNumber: state.moveNumber, player: state.turn,
      action: next.plies[0].action, search: observed, apiMs: elapsed, afterHash: stateHash(next.finalState) };
    try { writer.append(record); }
    catch (error) {
      if (error instanceof CapacityError) return end('capacity', 'Next legal move was computed but did not fit; not committed or counted.', null, elapsed);
      throw error;
    }
    state = next.finalState; plies++; apiMs += elapsed; onCommit?.(plies);
  }
}

function auditEvaluation(state: BoardState, search: SelfPlaySearchResult, mode: Mode) {
  if (search.evaluationBreakdown === null) return;
  assert.ok(search.principalVariation?.length);
  let leaf = state;
  for (const action of search.principalVariation) {
    const next = executeLegalAction(leaf, action, { proposer: 'local_ai' });
    assert.equal(next.type, 'applied'); if (next.type === 'applied') leaf = next.state;
  }
  assert.deepEqual(search.evaluationBreakdown, evaluateSearchPositionBreakdown(leaf, state.turn, { pieceSafetyMode: mode }));
}

export interface Audit {
  hash: string; status: 'complete' | 'incomplete' | 'corrupt'; error: string | null; partialTailBytes: number;
  start: StartRecord | null; moves: MoveRecord[]; end: EndRecord | null; finalHash: string | null;
}
export function auditJournal(path: string): Audit {
  const read = readJournal(path);
  const audit: Audit = { hash: read.hash, status: 'incomplete', error: read.error, partialTailBytes: read.partialTailBytes,
    start: null, moves: [], end: null, finalHash: null };
  try {
    const [first, ...records] = read.payloads as JournalRecord[];
    assert.ok(first?.type === 'start', 'missing start'); validateStart(first);
    assert.ok(read.bytes <= first.conditions.maxBytes, 'journal exceeds declared capacity');
    audit.start = first;
    let state = cloneBoardState(first.initialState), apiMs = 0;
    for (const record of records) {
      assert.equal(audit.end, null, 'record after end');
      if (record.type === 'move') {
        keys(record, ['type','ply','moveNumber','player','action','search','apiMs','afterHash']);
        assert.equal(record.ply, audit.moves.length + 1);
        assert.ok(record.ply <= first.conditions.maxPlies);
        assert.equal(record.moveNumber, state.moveNumber); assert.equal(record.player, state.turn);
        assert.ok(duration(record.apiMs));
        assert.ok(record.search.selectedAction && areLegalActionsEqual(record.action, record.search.selectedAction));
        const next = onePly(state, () => record.search);
        assert.notEqual(next.status, 'failed', next.status === 'failed' ? JSON.stringify(next.failure) : '');
        assert.equal(next.plies.length, 1, 'move after terminal');
        assert.deepEqual(next.plies[0].action, record.action);
        auditEvaluation(state, record.search, first.seats[state.turn]);
        assert.equal(record.afterHash, stateHash(next.finalState), 'post-move state mismatch');
        state = next.finalState; apiMs += record.apiMs; audit.moves.push(record);
      } else {
        assert.equal(record.type, 'end', 'unknown record type');
        const end = record as EndRecord;
        keys(end, ['type','reason','plies','finalHash','gameResult','apiMs','uncommittedApiMs','saveMsBeforeEnd','wallMsBeforeEnd','endedAt','detail','finalSearch']);
        assert.ok(['rule','max_plies','time_limit','interrupted','capacity','search_failure'].includes(end.reason));
        assert.equal(end.plies, audit.moves.length);
        for (const value of [end.apiMs,end.uncommittedApiMs,end.saveMsBeforeEnd,end.wallMsBeforeEnd]) assert.ok(duration(value));
        assert.equal(end.apiMs, apiMs);
        assert.ok(Number.isFinite(Date.parse(end.endedAt)) && Date.parse(end.endedAt) >= Date.parse(first.startedAt));
        assert.ok(end.detail === null || typeof end.detail === 'string');
        if (end.reason !== 'search_failure' && !(end.reason === 'rule' && state.status !== 'ended')) assert.equal(end.finalSearch, null);
        if (end.reason === 'rule' && state.status !== 'ended') {
          assert.ok(end.finalSearch && end.finalSearch.selectedAction === null);
          const next = onePly(state, () => end.finalSearch!);
          assert.equal(next.status, 'ended'); assert.equal(next.plies.length, 0); state = next.finalState;
        }
        if (end.reason === 'rule') { assert.equal(state.status, 'ended'); assert.ok(state.result); }
        else assert.notEqual(state.status, 'ended');
        if (end.reason === 'max_plies') assert.equal(end.plies, first.conditions.maxPlies);
        if (end.reason === 'time_limit') assert.ok(end.wallMsBeforeEnd >= first.conditions.gameMs);
        if (end.reason === 'interrupted') assert.ok(first.conditions.stopAfter !== null && end.plies >= first.conditions.stopAfter);
        if (end.reason === 'search_failure' || end.reason === 'capacity') assert.ok(end.detail);
        assert.equal(end.finalHash, stateHash(state));
        assert.deepEqual(end.gameResult, state.result ?? null);
        audit.end = end;
      }
    }
    audit.finalHash = stateHash(state);
    if (read.error) throw Error(read.error);
    audit.status = !read.partialTailBytes && audit.end && ['rule','max_plies'].includes(audit.end.reason) ? 'complete' : 'incomplete';
  } catch (error) { audit.status = 'corrupt'; audit.error = error instanceof Error ? error.message : String(error); }
  return audit;
}

export interface PlannedGame { runId: string; pairId: string; gameId: string }
export const identity = (g: PlannedGame) => `${g.runId}/${g.pairId}/${g.gameId}`;
export function aggregateJournals(paths: string[], expected: PlannedGame[] = []) {
  const byHash = new Set<string>(), byId = new Set<string>();
  const games: Audit[] = [];
  for (const path of paths) {
    const audit = auditJournal(path);
    if (byHash.has(audit.hash)) continue;
    byHash.add(audit.hash);
    if (audit.start) {
      const id = identity(audit.start);
      assert.ok(!byId.has(id), 'conflicting journals for ' + id); byId.add(id);
    }
    games.push(audit);
  }
  games.sort((a,b) => (a.start ? identity(a.start) : a.hash).localeCompare(b.start ? identity(b.start) : b.hash, 'en'));
  const plannedIds = expected.map(identity);
  assert.equal(new Set(plannedIds).size, plannedIds.length, 'duplicate planned game');
  if (expected.length) for (const id of byId) assert.ok(plannedIds.includes(id), 'unplanned game ' + id);
  const notRun = expected.filter(g => !byId.has(identity(g)));
  const groups = new Map<string, Audit[]>();
  for (const game of games) if (game.start) {
    const key = `${game.start.runId}/${game.start.pairId}`;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  const pairs = [...groups].map(([id, group]) => {
    assert.ok(group.length <= 2, 'too many games in pair ' + id);
    let complete = false;
    if (group.length === 2) {
      const [a,b] = group.map(g => g.start!);
      assert.equal(stateHash(a.initialState), stateHash(b.initialState), 'pair starting positions differ');
      assert.equal(canonical(a.conditions), canonical(b.conditions), 'pair conditions differ');
      assert.equal(a.sourceSha, b.sourceSha); assert.deepEqual(a.sourceHashes, b.sourceHashes);
      assert.notEqual(a.seats.sente, b.seats.sente, 'pair seats not exchanged');
      complete = group.every(g => g.status === 'complete');
    }
    return { id, complete, games: group.map(g => identity(g.start!)) };
  });
  const counts = (rows: Audit[]) => ({
    games: rows.length, complete: rows.filter(g => g.status === 'complete').length,
    legacyWins: rows.filter(g => g.status === 'complete' && g.end?.reason === 'rule' && g.end.gameResult?.winner && g.start!.seats[g.end.gameResult.winner] === 'legacy').length,
    experimentalWins: rows.filter(g => g.status === 'complete' && g.end?.reason === 'rule' && g.end.gameResult?.winner && g.start!.seats[g.end.gameResult.winner] === 'experimental').length,
    ruleDraws: rows.filter(g => g.status === 'complete' && g.end?.reason === 'rule' && g.end.gameResult?.winner === null).length,
    maxPlies: rows.filter(g => g.status === 'complete' && g.end?.reason === 'max_plies').length,
    incomplete: rows.filter(g => g.status === 'incomplete').length, corrupt: rows.filter(g => g.status === 'corrupt').length,
    incompleteReasons: Object.fromEntries(['no_end','partial_tail','time_limit','interrupted','capacity','search_failure'].map(reason => [reason,
      rows.filter(g => g.status === 'incomplete' && (g.partialTailBytes ? 'partial_tail' : g.end?.reason ?? 'no_end') === reason).length])),
  });
  const pairedIds = new Set(pairs.filter(p => p.complete).flatMap(p => p.games));
  const accepted = games.filter(g => g.status === 'complete');
  const metrics = (['legacy','experimental'] as const).map(mode => {
    const moves = accepted.flatMap(g => g.moves.filter(m => g.start!.seats[m.player] === mode));
    return { mode, plies: moves.length, apiMs: moves.reduce((sum,m) => sum + m.apiMs, 0),
      depthCounts: Object.fromEntries([...new Set(moves.map(m => String(m.search.completedDepth)))].sort().map(d => [d,moves.filter(m => String(m.search.completedDepth) === d).length])),
      partialRoot: moves.filter(m => m.search.resultSource === 'partial-root').length,
      fallback: moves.filter(m => m.search.resultSource === 'fallback').length };
  });
  // Derived JSON remains lossless even for a failed attempt containing ±Infinity/undefined.
  const endSummary = (end: EndRecord | null) => {
    if (!end) return null;
    const {finalSearch,...rest}=end;
    return {...rest,finalSearchEncoded:encode(finalSearch)};
  };
  return { counts: { ...counts(games), notRun: notRun.length }, completedPairs: pairs.filter(p => p.complete).length,
    pairedCounts: counts(games.filter(g => g.start && pairedIds.has(identity(g.start)))), metrics, pairs, notRun,
    games: games.map(g => ({ hash: g.hash, id: g.start ? identity(g.start) : null, status: g.status, error: g.error,
      partialTailBytes: g.partialTailBytes, plies: g.moves.length, end: endSummary(g.end), finalHash: g.finalHash })) };
}

export function reportSummary(summary: ReturnType<typeof aggregateJournals>): string {
  return '# Journal replay report\n\n' +
    `Games completed: ${summary.counts.complete}/${summary.counts.games + summary.counts.notRun}; completed exchanged pairs: ${summary.completedPairs}.\n\n` +
    'Counts (max_plies is NOT a draw):\n\n```json\n' + JSON.stringify(summary.counts, null, 2) + '\n```\n\n' +
    'Search API timings exclude journal writes/fsync; accepted games only:\n\n```json\n' + JSON.stringify(summary.metrics, null, 2) + '\n```\n\n' +
    'Per-game endings, persistence and wall time (before end-record write):\n\n```json\n' + JSON.stringify(summary.games, null, 2) + '\n```\n\n' +
    'Two pairs are insufficient to establish general playing strength. No coefficient or default-mode change.\n';
}
