import { describe, expect, it, vi } from 'vitest';
import { createInitialBoardState } from '../types/shogi';
import { executeLegalAction, getLegalActions, getQuiescenceLegalActionsWithDiagnostics } from '../domain/shogi/legalActions';
import { SearchDiagnostics } from '../domain/shogi/searchDiagnostics';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { protectSearchInput } from '../domain/shogi/selfPlayGame';

function position() {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  state.squares[8][4].piece = { id: 'sk', type: 'king', player: 'sente' };
  state.squares[0][4].piece = { id: 'gk', type: 'king', player: 'gote' };
  state.squares[2][2].piece = { id: 'ss', type: 'silver', player: 'sente' };
  state.squares[6][6].piece = { id: 'gs', type: 'silver', player: 'gote' };
  state.senteHand = [{ id: 'sp', type: 'pawn', player: 'sente' }];
  state.goteHand = [{ id: 'gp', type: 'pawn', player: 'gote' }];
  return state;
}

function probe(action: boolean, check = false, root = true) {
  let tick = 0;
  const clock = () => ++tick;
  const diagnostics = new SearchDiagnostics(false, root, check, action);
  diagnostics.begin(clock(), Infinity, clock);
  return { diagnostics, clock };
}

function semantic<T extends { elapsedMilliseconds: number }>(result: T) {
  const { elapsedMilliseconds: _elapsed, ...rest } = result;
  return rest;
}

function rootCounts(d: SearchDiagnostics) {
  return {
    board: d.phases['root-piece-moves'].calls,
    drop: d.phases['root-hand-drops'].calls,
    drops: Object.fromEntries(Object.entries(d.rootDrops).map(([type, entry]) =>
      [type, { calls: entry.calls, candidates: entry.candidates, legal: entry.legal,
        rejected: entry.rejected, stages: Object.fromEntries(Object.entries(entry.stages)
          .map(([stage, span]) => [stage, span.calls])) }])),
  };
}

function assertExecution(d: SearchDiagnostics, visited: number) {
  const spans = d.actionValidation!.snapshot();
  const executed = spans.executionBoard['execute-action'].calls + spans.executionDrop['execute-action'].calls;
  expect(executed).toBe(visited);
  expect(executed).toBe(d.phases['normal-execute'].calls + d.phases['q-execute'].calls);
  for (const origin of ['executionBoard', 'executionDrop'] as const) {
    const row = spans[origin];
    expect(row['execute-action'].calls).toBeGreaterThan(0);
    for (const stage of ['execute-api', 'validation', 'board-setup', 'own-check'] as const)
      expect(row[stage].calls).toBe(row['execute-action'].calls);
    expect(row['own-check'].inclusiveMilliseconds).toBeLessThanOrEqual(row.validation.inclusiveMilliseconds);
    expect(row.validation.inclusiveMilliseconds).toBeLessThanOrEqual(row['execute-api'].inclusiveMilliseconds);
    expect(row['execute-api'].inclusiveMilliseconds).toBeLessThanOrEqual(row['execute-action'].inclusiveMilliseconds);
  }
  for (const row of Object.values(spans)) for (const span of Object.values(row)) {
    expect(span.calls).toBeGreaterThanOrEqual(0);
    expect(span.inclusiveMilliseconds).toBeGreaterThanOrEqual(0);
  }
}

describe('combined probes and root diagnostic isolation', () => {
  it('preserves both board/drop detailed checks with all four diagnostic combinations', () => {
    const input = protectSearchInput(position());
    const date = vi.spyOn(Date, 'now').mockReturnValue(123456);
    try {
      const actions = getLegalActions(input.snapshot);
      const successors = actions.map(action => executeLegalAction(input.snapshot, action));
      const baselineProbe = probe(false).diagnostics;
      const baseline = analyzeAlphaBetaSearch(input.snapshot, 1, undefined, () => 0,
        { quiescence: { maxTacticalDepth: 1 } }, baselineProbe);
      const detailedCounts: unknown[] = [];
      const qCounts: unknown[] = [];
      for (const [action, check] of [[false, false], [true, false], [false, true], [true, true]]) {
        const { diagnostics: d, clock } = probe(action, check);
        expect(getLegalActions(input.snapshot, d)).toEqual(actions);
        expect(getQuiescenceLegalActionsWithDiagnostics(input.snapshot, d)).toEqual(actions);
        expect(actions.map(a => executeLegalAction(input.snapshot, a, undefined, d))).toEqual(successors);
        qCounts.push({ ...d.qLegalCounts });
        if (check) {
          detailedCounts.push(Object.values(d.checkInternals!).map(p => {
            const { timing: _timing, ...counts } = p.snapshot();
            expect(counts.checks).toBeGreaterThan(0);
            expect(counts.attackScans).toBe(counts.checks);
            expect(p.timing.check.calls).toBe(counts.checks);
            return counts;
          }));
          expect(d.checkInternals!.board.checks).toBe(d.phases['q-board-own-check'].calls);
          expect(d.checkInternals!.drop.checks).toBe(d.phases['q-drop-own-check'].calls);
        }
        if (action) {
          const spans = d.actionValidation!.snapshot();
          expect(spans.generationBoard['own-check'].calls).toBe(2 * d.phases['q-board-own-check'].calls);
          expect(spans.generationDrop['own-check'].calls).toBe(2 * d.phases['q-drop-own-check'].calls);
          expect(spans.executionBoard.validation.calls).toBe(actions.filter(a => a.kind === 'move').length);
          expect(spans.executionDrop.validation.calls).toBe(actions.filter(a => a.kind === 'drop').length);
          expect(spans.generationBoard['own-check'].inclusiveMilliseconds).toBeGreaterThan(0);
          expect(spans.generationDrop['own-check'].inclusiveMilliseconds).toBeGreaterThan(0);
        }
        const search = probe(action, check);
        const result = analyzeAlphaBetaSearch(input.snapshot, 1, undefined, search.clock,
          { quiescence: { maxTacticalDepth: 1 } }, search.diagnostics);
        expect(semantic(result)).toEqual(semantic(baseline));
        expect(search.diagnostics.qLegalCounts).toEqual(baselineProbe.qLegalCounts);
        if (action) assertExecution(search.diagnostics, result.visitedPositionCount + result.quiescenceVisitedPositionCount);
        if (check) for (const origin of ['board', 'drop'] as const)
          expect(search.diagnostics.checkInternals![origin].checks)
            .toBe(search.diagnostics.phases[`q-${origin}-own-check`].calls);
      }
      expect(detailedCounts[1]).toEqual(detailedCounts[0]);
      expect(qCounts.every(counts => JSON.stringify(counts) === JSON.stringify(qCounts[0]))).toBe(true);
      expect(input.wasMutated()).toBe(false);
    } finally { date.mockRestore(); }
  });

  it('counts internal generation at depth two without adding to root or quiescence aggregates', () => {
    const input = protectSearchInput(position());
    const root = probe(true).diagnostics;
    const actions = getLegalActions(input.snapshot, root);
    const generations: number[] = [];
    for (const depth of [1, 2]) {
      const { diagnostics: d, clock } = probe(true);
      const result = analyzeAlphaBetaSearch(input.snapshot, depth, undefined, clock, undefined, d);
      const off = probe(false);
      const plain = analyzeAlphaBetaSearch(input.snapshot, depth, undefined, off.clock, undefined, off.diagnostics);
      expect(semantic(result)).toEqual(semantic(plain));
      expect(rootCounts(d)).toEqual(rootCounts(root));
      expect(result.rootLegalActionCount).toBe(actions.length);
      expect(d.qLegalCounts).toEqual(off.diagnostics.qLegalCounts);
      expect(d.qLegalCounts.actions).toBe(0);
      assertExecution(d, result.visitedPositionCount + result.quiescenceVisitedPositionCount);
      const spans = d.actionValidation!.snapshot();
      generations.push(spans.generationBoard.validation.calls + spans.generationDrop.validation.calls);
      if (depth === 2) {
        expect(d.phases['normal-legal'].calls).toBeGreaterThan(0);
        expect(spans.generationBoard.validation.calls).toBeGreaterThan(root.actionValidation!.generationBoard.timing.validation.calls);
        expect(spans.generationDrop.validation.calls).toBeGreaterThan(root.actionValidation!.generationDrop.timing.validation.calls);
      }
    }
    expect(generations[1]).toBeGreaterThan(generations[0]);
    const on = probe(true);
    const off = probe(false);
    const options = { quiescence: { maxTacticalDepth: 1 } };
    const result = analyzeAlphaBetaSearch(input.snapshot, 2, undefined, on.clock, options, on.diagnostics);
    const plain = analyzeAlphaBetaSearch(input.snapshot, 2, undefined, off.clock, options, off.diagnostics);
    expect(semantic(result)).toEqual(semantic(plain));
    expect(rootCounts(on.diagnostics)).toEqual(rootCounts(root));
    expect(on.diagnostics.qLegalCounts).toEqual(off.diagnostics.qLegalCounts);
    expect(on.diagnostics.qLegalCounts.actions).toBeGreaterThan(0);
    assertExecution(on.diagnostics, result.visitedPositionCount + result.quiescenceVisitedPositionCount);
    expect(input.wasMutated()).toBe(false);
  });

  it('keeps timed rootBreakdown disabled while still collecting action validation', () => {
    const d = probe(true, false, false).diagnostics;
    const state = position();
    const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 100, undefined, () => 0, undefined, d);
    expect(result.completedDepth).toBe(2);
    expect(d.phases['root-piece-moves'].calls).toBe(0);
    expect(d.phases['root-hand-drops'].calls).toBe(0);
    expect(Object.values(d.rootDrops).every(entry => entry.candidates === 0 && entry.calls === 0)).toBe(true);
    expect(d.actionValidation!.generationBoard.timing.validation.calls).toBeGreaterThan(0);
    expect(d.actionValidation!.generationDrop.timing.validation.calls).toBeGreaterThan(0);
    const full = probe(true).diagnostics;
    const root = probe(true).diagnostics;
    const actions = getLegalActions(state, root);
    const fullResult = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 100, undefined, () => 0, undefined, full);
    expect(semantic(result)).toEqual(semantic(fullResult));
    expect(rootCounts(full)).toEqual(rootCounts(root));
    expect(d.depthOne!.rootCandidates).toBe(actions.length);
    expect(full.depthOne!.rootCandidates).toBe(actions.length);
  });
});
