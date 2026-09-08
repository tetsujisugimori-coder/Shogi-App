import { describe, expect, it } from 'vitest';
import {
  cloneBoardSquares,
  cloneBoardState,
  evaluateMaterial,
  executeLegalAction,
  getLegalActions,
  selectBestMaterialAction,
  type LegalAction,
  type MaterialValueTable,
} from '../domain/shogi';
import {
  createInitialBoardState,
  type BoardState,
  type Piece,
  type PieceType,
  type Player,
} from '../types/shogi';

function piece(id: string, type: PieceType, player: Player, isPromoted = false): Piece {
  return { id, type, player, ...(isPromoted ? { isPromoted: true } : {}) };
}

function createState(
  boardPieces: Array<{ row: number; col: number; piece: Piece }>,
  senteHand: Piece[] = [],
  goteHand: Piece[] = [],
  turn: Player = 'sente'
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  for (const item of boardPieces) squares[item.row][item.col].piece = { ...item.piece };

  return {
    ...initial,
    squares,
    senteHand: senteHand.map((handPiece) => ({ ...handPiece })),
    goteHand: goteHand.map((handPiece) => ({ ...handPiece })),
    turn,
  };
}

function basicCaptureState(turn: Player = 'sente'): BoardState {
  const mover = turn;
  const opponent = turn === 'sente' ? 'gote' : 'sente';
  const forwardTarget = turn === 'sente' ? 3 : 5;

  return createState([
    { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
    { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    { row: 4, col: 4, piece: piece(`${mover}-rook`, 'rook', mover) },
    { row: forwardTarget, col: 4, piece: piece(`${opponent}-pawn`, 'pawn', opponent) },
    { row: 4, col: 5, piece: piece(`${opponent}-silver`, 'silver', opponent) },
  ], [], [], turn);
}

function expectMove(
  action: LegalAction | null,
  from: { row: number; col: number },
  to: { row: number; col: number },
  promotion: 'none' | 'decline' | 'promote' = 'none'
): void {
  expect(action).toMatchObject({ kind: 'move', from, to, promotion });
}

describe('1手読み駒得AI', () => {
  it('全候補を仮想評価し、先頭ではない最も価値の高い駒取りを選ぶ', () => {
    const state = basicCaptureState();
    const actions = getLegalActions(state);
    const pawnCaptureIndex = actions.findIndex(
      (action) => action.kind === 'move' && action.to.row === 3 && action.to.col === 4
    );
    const silverCaptureIndex = actions.findIndex(
      (action) => action.kind === 'move' && action.to.row === 4 && action.to.col === 5
    );

    expect(pawnCaptureIndex).toBeGreaterThanOrEqual(0);
    expect(silverCaptureIndex).toBeGreaterThan(pawnCaptureIndex);
    expectMove(selectBestMaterialAction(state, 'sente'), { row: 4, col: 4 }, { row: 4, col: 5 });
  });

  it('成りによる既存の駒価値上昇を評価して成る手を選ぶ', () => {
    const state = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
      { row: 3, col: 4, piece: piece('sente-silver', 'silver', 'sente') },
      { row: 2, col: 3, piece: piece('left-blocker', 'gold', 'sente') },
      { row: 2, col: 5, piece: piece('right-blocker', 'gold', 'sente') },
    ]);

    expectMove(
      selectBestMaterialAction(state, 'sente'),
      { row: 3, col: 4 },
      { row: 2, col: 4 },
      'promote'
    );
  });

  it('駒取りで持ち駒になった駒を含めて評価する', () => {
    const state = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
      { row: 4, col: 4, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 5, piece: piece('gote-promoted-bishop', 'bishop', 'gote', true) },
    ]);
    const selected = selectBestMaterialAction(state, 'sente');

    expectMove(selected, { row: 4, col: 4 }, { row: 4, col: 5 });
    if (!selected) return;
    const execution = executeLegalAction(cloneBoardState(state), selected);
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;
    expect(execution.state.senteHand).toContainEqual({
      id: 'gote-promoted-bishop',
      type: 'bishop',
      player: 'sente',
      isPromoted: false,
    });
    expect(evaluateMaterial(execution.state, 'sente')).toBe(1800);
  });

  it('後手でも後手視点の最大値を選び、着手後の手番変更に影響されない', () => {
    const state = basicCaptureState('gote');
    const selected = selectBestMaterialAction(state, 'gote');

    expectMove(selected, { row: 4, col: 4 }, { row: 4, col: 5 });
    if (!selected) return;
    const execution = executeLegalAction(cloneBoardState(state), selected);
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;
    expect(execution.state.turn).toBe('sente');
    expect(evaluateMaterial(execution.state, 'gote')).toBeGreaterThan(
      evaluateMaterial(execution.state, 'sente')
    );
  });

  it('カスタム評価表をそのまま渡し、駒価値に従って選択を変える', () => {
    const state = basicCaptureState();
    const pawnFavoredTable: MaterialValueTable = {
      unpromoted: {
        pawn: 1000,
        lance: 300,
        knight: 300,
        silver: 1,
        gold: 500,
        bishop: 800,
        rook: 1000,
        king: 0,
      },
      promoted: { pawn: 500, lance: 500, knight: 500, silver: 500, bishop: 1000, rook: 1200 },
    };

    expectMove(
      selectBestMaterialAction(state, 'sente', pawnFavoredTable),
      { row: 4, col: 4 },
      { row: 3, col: 4 }
    );
  });

  it('同点では固定候補順の先頭を毎回選び、合法手がない場合はnullを返す', () => {
    const state = createState([
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 8, piece: piece('gote-king', 'king', 'gote') },
    ]);
    const actions = getLegalActions(state);

    expect(actions.length).toBeGreaterThan(1);
    expect(selectBestMaterialAction(state, 'sente')).toEqual(actions[0]);
    expect(selectBestMaterialAction(state, 'sente')).toEqual(actions[0]);
    expect(selectBestMaterialAction({ ...state, status: 'ended' }, 'sente')).toBeNull();
  });

  it('盤面、持ち駒、手番、履歴を含む呼び出し元の局面を変更しない', () => {
    const state = basicCaptureState();
    state.senteHand.push(piece('sente-hand-pawn', 'pawn', 'sente'));
    const snapshot = JSON.stringify(state);

    selectBestMaterialAction(state, 'sente');

    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
