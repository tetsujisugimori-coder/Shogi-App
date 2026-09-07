import { describe, expect, it, vi } from 'vitest';
import {
  cloneBoardSquares,
  executeLegalAction,
  getLegalActions,
  selectRandomLegalAction,
  type LegalAction,
  type RandomValueGenerator,
} from '../domain/shogi';
import {
  type BoardState,
  type Piece,
  type Player,
  createInitialBoardState,
} from '../types/shogi';

const senteKing: Piece = { id: 'king-s', type: 'king', player: 'sente' };
const goteKing: Piece = { id: 'king-g', type: 'king', player: 'gote' };

function createState(
  boardPieces: Array<{ row: number; col: number; piece: Piece }> = [
    { row: 8, col: 4, piece: senteKing },
    { row: 0, col: 4, piece: goteKing },
  ],
  senteHand: Piece[] = [],
  turn: Player = 'sente'
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  for (const item of boardPieces) squares[item.row][item.col].piece = { ...item.piece };

  return { ...initial, squares, senteHand: senteHand.map((piece) => ({ ...piece })), turn };
}

function randomForIndex(index: number, actionCount: number): RandomValueGenerator {
  return () => (index + 0.5) / actionCount;
}

function createActiveCheckmatePosition(): BoardState {
  return createState([
    { row: 8, col: 4, piece: senteKing },
    { row: 0, col: 4, piece: goteKing },
    { row: 1, col: 4, piece: { id: 'checking-pawn', type: 'pawn', player: 'sente' } },
    { row: 3, col: 4, piece: { id: 'checking-pawn-guard', type: 'rook', player: 'sente' } },
    { row: 0, col: 0, piece: { id: 'pinning-rook', type: 'rook', player: 'sente' } },
    { row: 0, col: 3, piece: { id: 'pinned-gold', type: 'gold', player: 'gote' } },
    { row: 0, col: 5, piece: { id: 'right-blocker', type: 'lance', player: 'gote' } },
    { row: 1, col: 3, piece: { id: 'left-front-blocker', type: 'pawn', player: 'gote' } },
    { row: 1, col: 5, piece: { id: 'right-front-blocker', type: 'pawn', player: 'gote' } },
  ], [], 'gote');
}

describe('ランダムAIの合法手選択', () => {
  it('初期局面の選択は全合法手の候補に含まれ、local_aiとして実行できる', () => {
    const state = createInitialBoardState();
    const actions = getLegalActions(state);
    const selected = selectRandomLegalAction(state, () => 0);

    expect(selected).toEqual(actions[0]);
    expect(actions).toContainEqual(selected);
    if (!selected) return;
    expect(executeLegalAction(state, selected, { proposer: 'local_ai' }).type).toBe('applied');
  });

  it('同じ局面と同じ乱数値では毎回同じ候補を選ぶ', () => {
    const state = createInitialBoardState();
    const random = () => 0.4;

    expect(selectRandomLegalAction(state, random)).toEqual(selectRandomLegalAction(state, random));
  });

  it('0では先頭、末尾区間の値では末尾、途中の値では対応するインデックスを選ぶ', () => {
    const state = createInitialBoardState();
    const actions = getLegalActions(state);
    const middleIndex = Math.floor(actions.length / 2);

    expect(selectRandomLegalAction(state, () => 0)).toEqual(actions[0]);
    expect(selectRandomLegalAction(state, () => 0.999999)).toEqual(actions.at(-1));
    expect(selectRandomLegalAction(state, randomForIndex(middleIndex, actions.length))).toEqual(
      actions[middleIndex]
    );
  });

  it('合法手が1件だけの局面では、その候補を選ぶ', () => {
    const state = createState([
      { row: 8, col: 8, piece: senteKing },
      { row: 4, col: 4, piece: { id: 'only-move-pawn', type: 'pawn', player: 'sente' } },
    ]);
    for (const row of state.squares) {
      for (const square of row) {
        if (!square.piece) square.piece = { id: `block-${square.row}-${square.col}`, type: 'pawn', player: 'sente' };
      }
    }
    state.squares[3][4].piece = null;

    const actions = getLegalActions(state);
    expect(actions).toHaveLength(1);
    expect(selectRandomLegalAction(state, () => 0.75)).toEqual(actions[0]);
  });

  it('終局済み局面ではnullを返し、乱数生成関数を呼ばない', () => {
    const state = { ...createInitialBoardState(), status: 'ended' as const };
    const random = vi.fn(() => 0.5);

    expect(selectRandomLegalAction(state, random)).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('既存の合法手列挙が空配列を返す局面ではnullを返す', () => {
    const state = createActiveCheckmatePosition();
    const random = vi.fn(() => 0.5);

    expect(getLegalActions(state)).toEqual([]);
    expect(selectRandomLegalAction(state, random)).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('選択の前後で入力局面も既存の候補列も変更しない', () => {
    const state = createInitialBoardState();
    const actions = getLegalActions(state);
    const stateSnapshot = JSON.stringify(state);
    const actionSnapshot = JSON.stringify(actions);

    selectRandomLegalAction(state, () => 0.4);

    expect(JSON.stringify(state)).toBe(stateSnapshot);
    expect(JSON.stringify(actions)).toBe(actionSnapshot);
  });

  it('任意成りと駒打ちの候補も、そのまま壊さず選択する', () => {
    const state = createState([
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      { row: 3, col: 4, piece: { id: 'optional-silver', type: 'silver', player: 'sente' } },
    ], [{ id: 'hand-gold', type: 'gold', player: 'sente' }]);
    const actions = getLegalActions(state);
    const candidates: LegalAction[] = [
      actions.find((action) => action.kind === 'move' && action.promotion === 'promote'),
      actions.find((action) => action.kind === 'drop'),
    ].filter((action): action is LegalAction => action !== undefined);

    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      const index = actions.indexOf(candidate);
      expect(selectRandomLegalAction(state, randomForIndex(index, actions.length))).toEqual(candidate);
    }
  });
});
