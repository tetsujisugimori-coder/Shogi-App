import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloneBoardState, createPositionKey, DEFAULT_MATERIAL_VALUE_TABLE, evaluateMaterial,
  evaluateStaticExchange, executeLegalAction, getLegalActions, isPlayerInCheck, validateMove,
  type LegalAction, type LegalMoveAction, type MaterialValueTable,
} from '../domain/shogi';
import * as legalActionsApi from '../domain/shogi/legalActions';
import { createInitialBoardState, type BoardState, type PieceType, type Player } from '../types/shogi';

type Placement = [row: number, col: number, type: PieceType, player: Player, promoted?: boolean];
const KINGS: Placement[] = [[8, 8, 'king', 'sente'], [0, 8, 'king', 'gote']];

function position(pieces: Placement[], kings = KINGS): BoardState {
  const state = createInitialBoardState();
  for (const row of state.squares) for (const square of row) square.piece = null;
  for (const [row, col, type, player, isPromoted = false] of [...kings, ...pieces]) {
    state.squares[row][col].piece = { id: `${player}-${row}-${col}`, type, player, isPromoted };
  }
  state.senteHand = [];
  state.goteHand = [];
  state.positionHistory = [];
  state.positionSnapshots = [];
  return state;
}

function move(
  state: BoardState, from: [number, number], to: [number, number] = [4, 4],
  promotion: LegalMoveAction['promotion'] = 'none'
): LegalMoveAction {
  const action = getLegalActions(state).find((candidate): candidate is LegalMoveAction =>
    candidate.kind === 'move' && candidate.from.row === from[0] && candidate.from.col === from[1] &&
    candidate.to.row === to[0] && candidate.to.col === to[1] && candidate.promotion === promotion
  );
  if (!action) throw new Error(`Fixture requires legal move ${from} -> ${to} (${promotion}).`);
  return action;
}

function apply(state: BoardState, action: LegalAction): BoardState {
  expect(getLegalActions(state)).toContainEqual(action);
  const execution = executeLegalAction(cloneBoardState(state), action);
  if (execution.type !== 'applied') throw new Error('Fixture action must apply.');
  return execution.state;
}

function delta(before: BoardState, after: BoardState, table = DEFAULT_MATERIAL_VALUE_TABLE as MaterialValueTable): number {
  return evaluateMaterial(after, before.turn, table) - evaluateMaterial(before, before.turn, table);
}

function recaptures(state: BoardState, target: [number, number] = [4, 4]): LegalMoveAction[] {
  return getLegalActions(state).filter((action): action is LegalMoveAction =>
    action.kind === 'move' && action.to.row === target[0] && action.to.col === target[1]
  );
}

function basic(extra: Placement[] = []): BoardState {
  return position([[5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote'], ...extra]);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => vi.restoreAllMocks());

describe('合法手ベースの静的交換評価', () => {
  it('無防備な歩の一回の捕獲は盤上喪失と持ち駒獲得の駒得差分になる', () => {
    const state = basic();
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    expect(recaptures(after)).toEqual([]);
    expect(delta(state, after)).toBe(200);
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
  });

  it('合法な非捕獲移動はnullを返す', () => {
    const state = basic();
    expect(evaluateStaticExchange(state, move(state, [5, 4], [5, 3]))).toBeNull();
  });

  it('合法な駒打ちはnullを返す', () => {
    const state = basic();
    state.senteHand.push({ id: 'hand', type: 'silver', player: 'sente' });
    const action = getLegalActions(state).find((candidate) => candidate.kind === 'drop');
    if (!action) throw new Error('Fixture requires a drop.');
    expect(evaluateStaticExchange(state, action)).toBeNull();
    expect(() => evaluateStaticExchange(state, { ...action, pieceId: 'missing' })).toThrow(/legal in the starting position/);
  });

  it.each([
    { player: 'gote' as const }, { pieceType: 'silver' as const },
    { from: { row: 5, col: 3 } }, { to: { row: -1, col: 4 } },
    { promotion: 'promote' as const },
  ])('合法手と不一致のフィールドを拒否する: %j', (override) => {
    const state = basic();
    expect(() => evaluateStaticExchange(state, { ...move(state, [5, 4]), ...override }))
      .toThrow(/legal in the starting position/);
  });

  it('終局済み開始局面で過去の合法手を受け付けない', () => {
    const state = basic();
    const action = move(state, [5, 4]);
    state.status = 'ended';
    state.result = { endReason: 'resignation', winner: 'sente', loser: 'gote' };
    expect(() => evaluateStaticExchange(state, action)).toThrow(/legal in the starting position/);
  });

  it('歩で飛車を取り返される交換損を評価する', () => {
    const state = basic([[3, 4, 'pawn', 'gote']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    const end = apply(after, move(after, [3, 4]));
    expect(delta(state, end)).toBe(-1800);
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, end));
  });

  it('相手は取り返すと損になるなら別の合法手を選んで交換を終了できる', () => {
    const state = position([[5, 4, 'pawn', 'sente'], [4, 4, 'pawn', 'gote'],
      [4, 0, 'rook', 'gote'], [5, 5, 'gold', 'sente']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    const reply = apply(after, move(after, [4, 0]));
    const end = apply(reply, move(reply, [5, 5]));
    expect(getLegalActions(after).length).toBeGreaterThan(recaptures(after).length);
    expect(delta(state, end)).toBeGreaterThan(delta(state, after));
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
  });

  it('開始側も取り返すと損になるなら現在の駒得差分で終了できる', () => {
    const state = basic([[3, 4, 'pawn', 'gote'], [4, 0, 'rook', 'sente'], [3, 5, 'gold', 'gote']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    const reply = apply(after, move(after, [3, 4]));
    const ownCapture = apply(reply, move(reply, [4, 0]));
    const end = apply(ownCapture, move(ownCapture, [3, 5]));
    expect(delta(state, end)).toBeLessThan(delta(state, reply));
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, reply));
  });

  it('唯一の合法手が取り返しなら、相手が損をしても任意停止しない', () => {
    const state = position([[1, 1, 'pawn', 'sente'], [0, 1, 'silver', 'gote'],
      [0, 2, 'rook', 'gote'], [2, 0, 'gold', 'sente'], [2, 1, 'rook', 'sente'],
      [2, 2, 'knight', 'sente']], [[8, 8, 'king', 'sente'], [0, 0, 'king', 'gote']]);
    const action = move(state, [1, 1], [0, 1], 'promote');
    const after = apply(state, action);
    const forced = move(after, [0, 2], [0, 1]);
    expect(isPlayerInCheck(after, 'gote')).toBe(true);
    expect(getLegalActions(after)).toEqual([forced]);
    const reply = apply(after, forced);
    const end = apply(reply, move(reply, [2, 1], [0, 1], 'promote'));
    expect(delta(state, end)).toBeGreaterThan(delta(state, after));
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, end));
  });

  it('開始側は複数の取り返しと任意成り候補から最大の最終差分を選ぶ', () => {
    const state = basic([[3, 4, 'gold', 'gote'], [2, 2, 'bishop', 'sente'], [5, 5, 'silver', 'sente']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    const reply = apply(after, move(after, [3, 4]));
    expect(recaptures(reply)).toHaveLength(3);
    const promoted = apply(reply, move(reply, [2, 2], [4, 4], 'promote'));
    const declined = apply(reply, move(reply, [2, 2], [4, 4], 'decline'));
    const silver = apply(reply, move(reply, [5, 5]));
    expect(delta(state, promoted)).toBeGreaterThan(delta(state, declined));
    expect(delta(state, promoted)).toBeGreaterThan(delta(state, silver));
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, promoted));
  });

  it('相手は複数の取り返しから最小の最終差分を選び、香車の開き利きも現れる', () => {
    const state = basic([[4, 0, 'rook', 'gote'], [3, 5, 'gold', 'gote'], [6, 4, 'lance', 'sente']]);
    expect(getLegalActions(state).some((a) => a.kind === 'move' && a.from.row === 6 && a.to.row === 4)).toBe(false);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    expect(recaptures(after)).toHaveLength(2);
    const goldFirst = apply(after, move(after, [3, 5]));
    const lanceAfterGold = apply(goldFirst, move(goldFirst, [6, 4]));
    const chosenEnd = apply(lanceAfterGold, move(lanceAfterGold, [4, 0]));
    const rookFirst = apply(after, move(after, [4, 0]));
    const lanceAfterRook = apply(rookFirst, move(rookFirst, [6, 4]));
    const otherEnd = apply(lanceAfterRook, move(lanceAfterRook, [3, 5]));
    expect(delta(state, chosenEnd)).toBe(-1400);
    expect(delta(state, chosenEnd)).toBeLessThan(delta(state, otherEnd));
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, chosenEnd));
  });

  it('ピンされた金の取り返しを含めない', () => {
    const state = position([[7, 4, 'rook', 'sente'], [3, 4, 'gold', 'gote'],
      [5, 3, 'pawn', 'sente'], [4, 3, 'pawn', 'gote']],
    [[8, 8, 'king', 'sente'], [0, 4, 'king', 'gote']]);
    const action = move(state, [5, 3], [4, 3]);
    const after = apply(state, action);
    expect(isPlayerInCheck(after, 'gote')).toBe(false);
    expect(validateMove(after, { row: 3, col: 4 }, { row: 4, col: 3 }))
      .toMatchObject({ isValid: false, reason: 'self_check_unresolved' });
    expect(recaptures(after, [4, 3])).toEqual([]);
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
  });

  it('開き王手を放置する別筋の取り返しを含めない', () => {
    const state = position([[2, 0, 'rook', 'sente'], [2, 6, 'bishop', 'sente'],
      [4, 4, 'pawn', 'gote'], [3, 4, 'gold', 'gote']],
    [[8, 8, 'king', 'sente'], [2, 8, 'king', 'gote']]);
    const action = move(state, [2, 6], [4, 4], 'decline');
    const after = apply(state, action);
    expect(isPlayerInCheck(after, 'gote')).toBe(true);
    expect(validateMove(after, { row: 3, col: 4 }, { row: 4, col: 4 }))
      .toMatchObject({ isValid: false, reason: 'self_check_unresolved' });
    expect(recaptures(after)).toEqual([]);
    expect(getLegalActions(after).length).toBeGreaterThan(0);
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
  });

  it.each([false, true])('玉による取り返しは敵の利きの有無を既存合法手に従って扱う: 守り=%s', (defended) => {
    const state = position([[5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote'],
      ...(defended ? [[5, 5, 'gold', 'sente'] satisfies Placement] : [])],
    [[8, 8, 'king', 'sente'], [3, 4, 'king', 'gote']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    expect(recaptures(after)).toHaveLength(defended ? 0 : 1);
    const end = defended ? after : apply(after, move(after, [3, 4]));
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, end));
  });

  it('最初の駒取りで任意成りの2候補を別々に評価する', () => {
    const state = position([[3, 4, 'silver', 'sente'], [2, 4, 'pawn', 'gote']]);
    const decline = move(state, [3, 4], [2, 4], 'decline');
    const promote = move(state, [3, 4], [2, 4], 'promote');
    expect(evaluateStaticExchange(state, decline)).toBe(delta(state, apply(state, decline)));
    expect(evaluateStaticExchange(state, promote)).toBe(delta(state, apply(state, promote)));
    expect(evaluateStaticExchange(state, promote)).toBeGreaterThan(evaluateStaticExchange(state, decline)!);
  });

  it('最終段へ進む歩は強制成りとして評価し、不成を拒否する', () => {
    const state = position([[1, 4, 'pawn', 'sente'], [0, 4, 'silver', 'gote']]);
    const action = move(state, [1, 4], [0, 4], 'promote');
    const after = apply(state, action);
    expect(after.squares[0][4].piece?.isPromoted).toBe(true);
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
    expect(() => evaluateStaticExchange(state, { ...action, promotion: 'decline' })).toThrow(/legal in the starting position/);
  });

  it('成駒の捕獲は盤上の成駒価値と持ち駒の元の価値を使う', () => {
    const state = position([[5, 4, 'rook', 'sente'], [4, 4, 'bishop', 'gote', true]]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    expect(after.senteHand).toContainEqual({ id: 'gote-4-4', type: 'bishop', player: 'sente', isPromoted: false });
    expect(delta(state, after)).toBe(1800);
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
  });

  it('カスタム価値表を再帰全体へ渡して既存駒得差分を使う', () => {
    const table: MaterialValueTable = {
      unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, rook: 750, pawn: 37 },
      promoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.promoted, bishop: 2500 },
    };
    const state = basic([[3, 4, 'gold', 'gote'], [2, 2, 'bishop', 'sente']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    const reply = apply(after, move(after, [3, 4]));
    const promoted = apply(reply, move(reply, [2, 2], [4, 4], 'promote'));
    // With this table the opponent prefers stopping to allowing the bishop promotion.
    expect(delta(state, promoted, table)).toBeGreaterThan(delta(state, after, table));
    expect(evaluateStaticExchange(state, action, table)).toBe(delta(state, after, table));
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, promoted));
  });

  it('先後を交換して盤を180度回転しても開始側の点数は一致する', () => {
    const pieces: Placement[] = [...KINGS, [5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote'],
      [4, 0, 'rook', 'gote'], [3, 5, 'gold', 'gote'], [6, 4, 'lance', 'sente']];
    const state = position(pieces, []);
    const rotated = position(pieces.map(([row, col, type, player, promoted]) =>
      [8 - row, 8 - col, type, player === 'sente' ? 'gote' : 'sente', promoted]), []);
    rotated.turn = 'gote';
    expect(evaluateStaticExchange(rotated, move(rotated, [3, 4])))
      .toBe(evaluateStaticExchange(state, move(state, [5, 4])));
  });

  it('実際の棋譜・履歴・持ち駒・合法手・価値表を凍結しても決定的で非破壊', () => {
    const state = apply(basic([[3, 4, 'pawn', 'gote']]), move(basic(), [5, 4]));
    const action = move(state, [3, 4]);
    const table: MaterialValueTable = structuredClone(DEFAULT_MATERIAL_VALUE_TABLE);
    const before = structuredClone({ state, action, table });
    freezeDeep(state);
    freezeDeep(action);
    freezeDeep(table);
    const generated: LegalAction[][] = [];
    const actual = legalActionsApi.getLegalActions;
    vi.spyOn(legalActionsApi, 'getLegalActions').mockImplementation((input) => {
      const actions = freezeDeep(actual(input));
      generated.push(actions);
      return actions;
    });
    expect(state.history.length).toBeGreaterThan(0);
    expect(state.positionHistory!.length).toBeGreaterThan(0);
    expect(state.positionSnapshots!.length).toBeGreaterThan(0);
    const first = evaluateStaticExchange(state, action, table);
    expect(evaluateStaticExchange(state, action, table)).toBe(first);
    expect({ state, action, table }).toEqual(before);
    expect(generated.length).toBeGreaterThan(0);
  });

  it('実行される再帰は対象マスの捕獲だけで、別の捕獲・駒打ち・静かな手を含まない', () => {
    const state = basic([[3, 4, 'pawn', 'gote'], [5, 5, 'gold', 'sente'],
      [1, 0, 'rook', 'gote'], [1, 2, 'silver', 'sente']]);
    state.goteHand.push({ id: 'hand', type: 'silver', player: 'gote' });
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    expect(getLegalActions(after).some((a) => a.kind === 'drop')).toBe(true);
    expect(getLegalActions(after)).toContainEqual(move(after, [1, 0], [1, 2]));
    const spy = vi.spyOn(legalActionsApi, 'executeLegalAction');
    evaluateStaticExchange(state, action);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
    for (const [input, executed] of spy.mock.calls) {
      expect(executed.kind).toBe('move');
      expect(executed.to).toEqual({ row: 4, col: 4 });
      const target = input.squares[4][4].piece;
      expect(target).not.toBeNull();
      expect(target?.player).not.toBe(executed.player);
    }
  });

  it('捕獲で詰んでも勝敗の無限値へ変換せず駒得差分を返す', () => {
    const state = position([[2, 4, 'rook', 'sente'], [1, 4, 'silver', 'gote'],
      [2, 3, 'gold', 'sente'], [2, 1, 'bishop', 'sente'], [2, 7, 'bishop', 'sente']],
    [[8, 4, 'king', 'sente'], [0, 4, 'king', 'gote']]);
    const action = move(state, [2, 4], [1, 4], 'promote');
    const after = apply(state, action);
    expect(after).toMatchObject({ status: 'ended', result: { endReason: 'checkmate' } });
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
    expect(Number.isFinite(evaluateStaticExchange(state, action))).toBe(true);
  });

  it.each([0, 1])('生成された合法手を実行できない場合は契約違反を通知する: ply=%s', (ply) => {
    const state = basic([[3, 4, 'pawn', 'gote']]);
    const action = move(state, [5, 4]);
    const rejected = executeLegalAction(state, { ...action, to: { row: -1, col: 4 } });
    expect(rejected.type).not.toBe('applied');
    const actual = legalActionsApi.executeLegalAction;
    const spy = vi.spyOn(legalActionsApi, 'executeLegalAction');
    if (ply === 1) spy.mockImplementationOnce(actual);
    spy.mockReturnValueOnce(rejected);
    expect(() => evaluateStaticExchange(state, action)).toThrow(/legal-action contract violated/);
  });

  it('非終局でも合法手がない人工局面では現在差分で終了する', () => {
    const state = position([[5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote']],
      [[8, 8, 'king', 'sente']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    expect(after.status).not.toBe('ended');
    expect(getLegalActions(after)).toEqual([]);
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, after));
  });

  it('既存履歴によって千日手になった場合は取り返しを続けず駒得差分を返す', () => {
    const state = basic([[3, 4, 'pawn', 'gote']]);
    const action = move(state, [5, 4]);
    const after = apply(state, action);
    expect(recaptures(after)).toHaveLength(1);
    // Synthetic prior occurrences exercise the existing adjudicator, not a SEE rule.
    state.positionHistory = [0, 1, 2].map((historyIndex) => ({
      key: createPositionKey(after), historyIndex, movedBy: null, gaveCheck: false,
    }));
    state.positionHistory.push({ key: createPositionKey(state), historyIndex: 3, movedBy: null, gaveCheck: false });
    const terminal = apply(state, action);
    expect(terminal).toMatchObject({ status: 'ended', result: { endReason: 'repetition' } });
    expect(evaluateStaticExchange(state, action)).toBe(delta(state, terminal));
    expect(evaluateStaticExchange(state, action)).toBe(200);
  });

  it.each([Infinity, NaN, Number.MAX_VALUE])('有限の駒得差分を作れない価値表は非有限値を返さず拒否: %s', (pawn) => {
    const table: MaterialValueTable = {
      unpromoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.unpromoted, pawn },
      promoted: { ...DEFAULT_MATERIAL_VALUE_TABLE.promoted },
    };
    const state = basic();
    expect(() => evaluateStaticExchange(state, move(state, [5, 4]), table)).toThrow(/finite material difference/);
  });
});
