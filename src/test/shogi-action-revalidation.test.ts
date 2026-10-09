import { describe, expect, it, vi } from 'vitest';
import { createInitialBoardState } from '../types/shogi';
import { getLegalActions, executeLegalAction, getQuiescenceLegalActionsWithDiagnostics, type LegalAction } from '../domain/shogi/legalActions';
import { SearchDiagnostics } from '../domain/shogi/searchDiagnostics';
import { analyzeAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { protectSearchInput } from '../domain/shogi/selfPlayGame';
import { ActionValidationProbe } from '../domain/shogi/actionValidationDiagnostics';

function position() {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  state.squares[8][4].piece = { id: 'sk', type: 'king', player: 'sente' };
  state.squares[0][4].piece = { id: 'gk', type: 'king', player: 'gote' };
  state.squares[2][2].piece = { id: 'silver', type: 'silver', player: 'sente' };
  state.senteHand = [{ id: 'pawn', type: 'pawn', player: 'sente' }];
  return state;
}
const diagnostic = () => {
  let tick = 0;
  const clock = () => ++tick;
  const probe = new SearchDiagnostics(false, true, false, true);
  probe.begin(clock(), Infinity, clock);
  return { probe, clock };
};

describe('opt-in action revalidation diagnostics', () => {
  it('preserves ordered legal actions, all successor states, promotion and input state', () => {
    const input = protectSearchInput(position());
    const { probe } = diagnostic();
    const actions = getLegalActions(input.snapshot);
    expect(getLegalActions(input.snapshot, probe)).toEqual(actions);
    expect(getQuiescenceLegalActionsWithDiagnostics(input.snapshot, probe)).toEqual(actions);
    expect(actions.some(a => a.kind === 'move' && a.promotion === 'promote')).toBe(true);
    const date = vi.spyOn(Date, 'now').mockReturnValue(123456);
    try {
      for (const action of actions) expect(executeLegalAction(input.snapshot, action, undefined, probe))
        .toEqual(executeLegalAction(input.snapshot, action));
    } finally { date.mockRestore(); }
    expect(input.wasMutated()).toBe(false);
    const d = probe.actionValidation!.snapshot();
    for (const [origin, kind] of [['executionBoard', 'move'], ['executionDrop', 'drop']] as const) {
      const count = actions.filter(a => a.kind === kind).length;
      for (const stage of ['execute-action', 'execute-api', 'validation', 'board-setup', 'own-check'] as const)
        expect(d[origin][stage].calls).toBe(count);
    }
    expect(d.executionDrop['pawn-drop-mate'].calls).toBe(1);
    expect(d.generationDrop['pawn-drop-mate'].calls).toBe(2);
    expect(d.generationDrop.validation.calls).toBe(162);
    expect(d.generationBoard.validation.calls).toBe(d.generationBoard['own-check'].calls);
    for (const spans of Object.values(d)) for (const span of Object.values(spans)) {
      expect(span.calls).toBeGreaterThanOrEqual(0);
      expect(span.inclusiveMilliseconds).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps public rejection and conditional drop checks, including pawn-drop mate', () => {
    const state = position();
    // Surround the opponent king with its own blockers and defend the dropped pawn.
    state.squares[2][4].piece = { id: 'rook', type: 'rook', player: 'sente' };
    for (const [row, col] of [[0, 3], [0, 5], [1, 3], [1, 5]])
      state.squares[row][col].piece = { id: `block-${row}-${col}`, type: 'lance', player: 'gote' };
    const input = protectSearchInput(state);
    const { probe } = diagnostic();
    const pawnMate: LegalAction = { kind: 'drop', player: 'sente', pieceId: 'pawn',
      pieceType: 'pawn', promotion: 'none', to: { row: 1, col: 4 } };
    expect(executeLegalAction(input.snapshot, pawnMate, undefined, probe))
      .toEqual(executeLegalAction(input.snapshot, pawnMate));
    expect(executeLegalAction(input.snapshot, pawnMate, undefined, probe))
      .toMatchObject({ type: 'rejected', reason: 'pawn_drop_mate' });
    const invalid = { ...pawnMate, to: { row: -1, col: 4 } };
    expect(executeLegalAction(input.snapshot, invalid, undefined, probe))
      .toMatchObject({ type: 'rejected', reason: 'out_of_bounds' });
    const invalidMove: LegalAction = { kind: 'move', player: 'sente', pieceType: 'king',
      promotion: 'none', from: { row: 8, col: 4 }, to: { row: 5, col: 4 } };
    expect(executeLegalAction(input.snapshot, invalidMove, undefined, probe))
      .toEqual(executeLegalAction(input.snapshot, invalidMove));
    const d = probe.actionValidation!.snapshot();
    expect(d.executionDrop.validation.calls).toBe(3);
    expect(d.executionDrop['pawn-drop-mate'].calls).toBe(2);
    expect(d.executionDrop['board-setup'].calls).toBe(2);
    expect(d.executionDrop['own-check'].calls).toBe(2);
    expect(input.wasMutated()).toBe(false);
  });

  it('preserves full search semantics and counts executed children once across normal and quiescence search', () => {
    const state = position();
    const options = { quiescence: { maxTacticalDepth: 1 } };
    const plain = analyzeAlphaBetaSearch(state, 2, undefined, () => 0, options);
    const { probe, clock } = diagnostic();
    const detailed = analyzeAlphaBetaSearch(state, 2, undefined, clock, options, probe);
    const { elapsedMilliseconds: _a, ...plainSemantic } = plain;
    const { elapsedMilliseconds: _b, ...detailedSemantic } = detailed;
    expect(detailedSemantic).toEqual(plainSemantic);
    const d = probe.actionValidation!.snapshot();
    const executed = d.executionBoard['execute-action'].calls + d.executionDrop['execute-action'].calls;
    expect(executed).toBe(detailed.visitedPositionCount + detailed.quiescenceVisitedPositionCount);
    expect(executed).toBe(probe.phases['normal-execute'].calls + probe.phases['q-execute'].calls);
    expect(d.executionBoard.validation.calls).toBe(d.executionBoard['execute-action'].calls);
    expect(d.executionDrop.validation.calls).toBe(d.executionDrop['execute-action'].calls);
    expect(new SearchDiagnostics().actionValidation).toBeNull();
  });

  it('uses only the supplied clock, closes spans on exceptions and snapshots without aliasing', () => {
    let time = 0;
    const probe = new ActionValidationProbe(() => time++);
    expect(() => probe.measure('validation', () => { throw new Error('test'); })).toThrow('test');
    expect(probe.timing.validation).toEqual({ calls: 1, inclusiveMilliseconds: 1 });
    const { probe: search } = diagnostic();
    const snapshot = search.actionValidation!.snapshot();
    search.actionValidation!.executionDrop.measure('own-check', () => false);
    expect(snapshot.executionDrop['own-check'].calls).toBe(0);
  });
});
