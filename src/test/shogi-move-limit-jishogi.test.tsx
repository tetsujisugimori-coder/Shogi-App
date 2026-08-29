import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import * as shogiDomain from '../domain/shogi';
import {
  classifyMoveLimitJishogi,
  cloneBoardSquares,
  createPositionKey,
  executeDrop,
  executeEnteringKingDeclaration,
  executeMove,
  executeResignation,
} from '../domain/shogi';
import type {
  BoardState,
  GameResult,
  Piece,
  Player,
} from '../types/shogi';
import { createInitialBoardState } from '../types/shogi';

interface Placement {
  row: number;
  col: number;
  piece: Piece;
}

type MoveStep = readonly [number, number, number, number];

const senteKing: Piece = { id: 'sente-king', type: 'king', player: 'sente' };
const goteKing: Piece = { id: 'gote-king', type: 'king', player: 'gote' };

function createPosition(
  turn: Player,
  placements: Placement[],
  overrides: Partial<BoardState> = {}
): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) {
    for (const square of row) square.piece = null;
  }
  for (const placement of placements) {
    squares[placement.row][placement.col].piece = { ...placement.piece };
  }
  return {
    ...initial,
    squares,
    turn,
    senteHand: [],
    goteHand: [],
    ...overrides,
  };
}

function applyMove(state: BoardState, step: MoveStep): BoardState {
  const [fromRow, fromCol, toRow, toCol] = step;
  const piece = state.squares[fromRow][fromCol].piece;
  const result = executeMove(
    state,
    { row: fromRow, col: fromCol },
    { row: toRow, col: toCol },
    {
      mode: 'assist',
      ...(piece?.type === 'rook' ? { promotion: 'decline' as const } : {}),
    }
  );
  expect(result.type).toBe('applied');
  if (result.type !== 'applied') throw new Error(`unexpected move result: ${result.type}`);
  return result.state;
}

function createQuietKingPosition(turn: Player, moveNumber: number): BoardState {
  return createPosition(
    turn,
    [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
    ],
    { moveNumber }
  );
}

function createSenteCheckingPosition(moveNumber = 500): BoardState {
  return createPosition(
    'sente',
    [
      { row: 8, col: 8, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      {
        row: 1,
        col: 3,
        piece: { id: 'sente-checking-rook', type: 'rook', player: 'sente' },
      },
    ],
    { moveNumber }
  );
}

function createGoteCheckingPosition(moveNumber = 500): BoardState {
  return createPosition(
    'gote',
    [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 8, piece: goteKing },
      {
        row: 7,
        col: 3,
        piece: { id: 'gote-checking-rook', type: 'rook', player: 'gote' },
      },
    ],
    { moveNumber }
  );
}

function createSenteMatingMovePosition(overrides: Partial<BoardState> = {}): BoardState {
  return createPosition(
    'sente',
    [
      { row: 8, col: 4, piece: senteKing },
      { row: 0, col: 4, piece: goteKing },
      {
        row: 2,
        col: 4,
        piece: { id: 'mating-rook', type: 'rook', player: 'sente' },
      },
      {
        row: 1,
        col: 4,
        piece: { id: 'captured-silver', type: 'silver', player: 'gote' },
      },
      {
        row: 2,
        col: 3,
        piece: { id: 'rook-defender', type: 'gold', player: 'sente' },
      },
      {
        row: 2,
        col: 1,
        piece: { id: 'left-guard', type: 'bishop', player: 'sente' },
      },
      {
        row: 2,
        col: 7,
        piece: { id: 'right-guard', type: 'bishop', player: 'sente' },
      },
    ],
    overrides
  );
}

const senteCheckingCycle: readonly MoveStep[] = [
  [1, 3, 1, 4],
  [0, 4, 0, 3],
  [1, 4, 1, 3],
  [0, 3, 0, 4],
];

const kingCycle: readonly MoveStep[] = [
  [8, 4, 8, 3],
  [0, 4, 0, 3],
  [8, 3, 8, 4],
  [0, 3, 0, 4],
];

function applySequence(state: BoardState, steps: readonly MoveStep[]): BoardState {
  return steps.reduce(applyMove, state);
}

describe('500手規定の境界・着手反映', () => {
  it('完了499手では持将棋にならず、moveNumberを次の手番号として扱う', () => {
    const result = applyMove(createQuietKingPosition('sente', 499), [8, 4, 8, 3]);
    expect(result.moveNumber).toBe(500);
    expect(result.status).toBe('active');
    expect(result.result).toBeNull();
    expect(result.moveLimitJishogi).toBeNull();
  });

  it.each([
    ['sente', [8, 4, 8, 3]],
    ['gote', [0, 4, 0, 3]],
  ] as const)('%sの500手目の非王手着手後に無勝負となる', (turn, step) => {
    const result = applyMove(createQuietKingPosition(turn, 500), step);
    expect(result.moveNumber).toBe(501);
    expect(result.status).toBe('ended');
    expect(result.result).toEqual({
      winner: null,
      loser: null,
      endReason: 'five_hundred_move_jishogi',
      details: '500手規定による持将棋・無勝負',
    });
  });

  it('500手を超えた外部局面もhistory.lengthで補正せず、次の合法非王手後に終局する', () => {
    const state = createQuietKingPosition('sente', 777);
    state.history = [];
    delete state.moveLimitJishogi;
    const result = applyMove(state, [8, 4, 8, 3]);
    expect(result.moveNumber).toBe(778);
    expect(result.result?.endReason).toBe('five_hundred_move_jishogi');
  });

  it('500手目の通常移動を盤面・手番・棋譜・最終手・局面履歴へ残し、入力を破壊しない', () => {
    const state = createQuietKingPosition('sente', 500);
    const snapshot = JSON.stringify(state);
    const result = applyMove(state, [8, 4, 8, 3]);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(result.squares[8][4].piece).toBeNull();
    expect(result.squares[8][3].piece?.id).toBe('sente-king');
    expect(result.turn).toBe('gote');
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ moveNumber: 500, player: 'sente' });
    expect(result.lastMove).toBe(result.history[0]);
    expect(result.positionHistory).toHaveLength(2);
    expect(result.positionHistory?.at(-1)?.key).toBe(createPositionKey(result));
  });

  it('成りを伴う500手目も成りと棋譜を記録してから終局する', () => {
    const state = createPosition(
      'sente',
      [
        { row: 8, col: 8, piece: senteKing },
        { row: 0, col: 0, piece: goteKing },
        { row: 3, col: 4, piece: { id: 'rook', type: 'rook', player: 'sente' } },
      ],
      { moveNumber: 500 }
    );
    const result = executeMove(state, { row: 3, col: 4 }, { row: 2, col: 4 }, {
      promotion: 'promote',
    });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.result?.endReason).toBe('five_hundred_move_jishogi');
    expect(result.state.squares[2][4].piece?.isPromoted).toBe(true);
    expect(result.state.lastMove).toMatchObject({
      moveNumber: 500,
      promotion: 'promote',
      notation: '▲5三飛成',
    });
  });

  it('駒打ちでも500手目を共通判定し、持ち駒と履歴を更新してから終局する', () => {
    const gold: Piece = { id: 'drop-gold', type: 'gold', player: 'sente' };
    const state = {
      ...createQuietKingPosition('sente', 500),
      senteHand: [gold],
    };
    const result = executeDrop(state, gold.id, { row: 4, col: 4 });
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.result?.endReason).toBe('five_hundred_move_jishogi');
    expect(result.state.senteHand).toEqual([]);
    expect(result.state.squares[4][4].piece?.id).toBe(gold.id);
    expect(result.state.lastMove).toMatchObject({
      kind: 'drop', moveNumber: 500, notation: '▲5五金打',
    });
    expect(result.state.positionHistory?.at(-1)?.key).toBe(createPositionKey(result.state));
  });

  it('不正手では手数も待機状態も進めず、入力stateをそのまま返す', () => {
    const state = createQuietKingPosition('sente', 500);
    const result = executeMove(state, { row: 8, col: 4 }, { row: 8, col: 4 });
    expect(result.type).toBe('rejected');
    expect(result.state).toBe(state);
    expect(result.state.moveNumber).toBe(500);
    expect(result.state.moveLimitJishogi).toBeUndefined();
  });
});

describe('500手目からの連続王手待機', () => {
  it('500手目が王手なら開始側を保持し、直後には終局しない', () => {
    const result = applyMove(createSenteCheckingPosition(), [1, 3, 1, 4]);
    expect(result.moveNumber).toBe(501);
    expect(result.status).toBe('check');
    expect(result.result).toBeNull();
    expect(result.moveLimitJishogi).toEqual({
      kind: 'awaiting_continuous_check_end',
      checkingPlayer: 'sente',
    });
  });

  it('501手目で王手を回避しても終局せず、開始側の情報を維持する', () => {
    const afterCheck = applyMove(createSenteCheckingPosition(), [1, 3, 1, 4]);
    const response = applyMove(afterCheck, [0, 4, 0, 3]);
    expect(response.moveNumber).toBe(502);
    expect(response.status).toBe('active');
    expect(response.result).toBeNull();
    expect(response.moveLimitJishogi?.checkingPlayer).toBe('sente');
  });

  it('開始側の次の着手も王手なら継続する', () => {
    const state = applySequence(createSenteCheckingPosition(), [
      [1, 3, 1, 4],
      [0, 4, 0, 3],
      [1, 4, 1, 3],
    ]);
    expect(state.moveNumber).toBe(503);
    expect(state.status).toBe('check');
    expect(state.result).toBeNull();
    expect(state.moveLimitJishogi?.checkingPlayer).toBe('sente');
  });

  it('開始側の次の着手が王手でなければ、その着手を反映して持将棋にする', () => {
    const beforeBreak = applySequence(createSenteCheckingPosition(), [
      [1, 3, 1, 4],
      [0, 4, 0, 3],
    ]);
    const result = applyMove(beforeBreak, [1, 4, 2, 4]);
    expect(result.moveNumber).toBe(503);
    expect(result.squares[2][4].piece?.id).toBe('sente-checking-rook');
    expect(result.lastMove).toMatchObject({ moveNumber: 502, to: { row: 2, col: 4 } });
    expect(result.result?.endReason).toBe('five_hundred_move_jishogi');
    expect(result.moveLimitJishogi).toBeNull();
  });

  it('複数回王手を継続しても、開始側の王手が途切れるまで待つ', () => {
    const beforeBreak = applySequence(createSenteCheckingPosition(), [
      ...senteCheckingCycle,
    ]);
    expect(beforeBreak.moveNumber).toBe(504);
    expect(beforeBreak.moveLimitJishogi?.checkingPlayer).toBe('sente');
    const result = applyMove(beforeBreak, [1, 3, 2, 3]);
    expect(result.moveNumber).toBe(505);
    expect(result.result?.endReason).toBe('five_hundred_move_jishogi');
  });

  it('後手開始でも応手側と王手開始側を取り違えない', () => {
    const afterCheck = applyMove(createGoteCheckingPosition(), [7, 3, 7, 4]);
    expect(afterCheck.moveLimitJishogi?.checkingPlayer).toBe('gote');
    const response = applyMove(afterCheck, [8, 4, 8, 3]);
    expect(response.status).toBe('active');
    expect(response.result).toBeNull();
    expect(response.moveLimitJishogi?.checkingPlayer).toBe('gote');
    const result = applyMove(response, [7, 4, 6, 4]);
    expect(result.result?.endReason).toBe('five_hundred_move_jishogi');
  });

  it('駒打ちの王手で500手に達した場合も、応手後に開始側の非王手まで待つ', () => {
    const rook: Piece = { id: 'checking-drop-rook', type: 'rook', player: 'sente' };
    const state = createPosition(
      'sente',
      [
        { row: 8, col: 8, piece: senteKing },
        { row: 0, col: 4, piece: goteKing },
      ],
      { moveNumber: 500, senteHand: [rook] }
    );
    const dropped = executeDrop(state, rook.id, { row: 1, col: 4 });
    expect(dropped.type).toBe('applied');
    if (dropped.type !== 'applied') return;
    expect(dropped.state.moveLimitJishogi?.checkingPlayer).toBe('sente');
    const response = applyMove(dropped.state, [0, 4, 0, 3]);
    expect(response.result).toBeNull();
    const result = applyMove(response, [1, 4, 2, 4]);
    expect(result.result?.endReason).toBe('five_hundred_move_jishogi');
  });

  it('待機中の不正手は待機状態と手数を変えない', () => {
    const pending = applySequence(createSenteCheckingPosition(), [
      [1, 3, 1, 4],
      [0, 4, 0, 3],
    ]);
    const result = executeMove(pending, { row: 1, col: 4 }, { row: 1, col: 4 });
    expect(result.type).toBe('rejected');
    expect(result.state).toBe(pending);
    expect(result.state.moveNumber).toBe(502);
    expect(result.state.moveLimitJishogi).toBe(pending.moveLimitJishogi);
  });

  it('純粋判定APIは未指定フィールドを安全に扱い、入力を変更しない', () => {
    const state = createQuietKingPosition('sente', 501);
    delete state.moveLimitJishogi;
    const snapshot = JSON.stringify(state);
    expect(classifyMoveLimitJishogi(state, 'sente', false)).toEqual({ kind: 'draw' });
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(shogiDomain.classifyMoveLimitJishogi).toBe(classifyMoveLimitJishogi);
  });
});

describe('終局条件の優先順位と終局操作', () => {
  it('500手目の詰みを持将棋より優先する', () => {
    const result = executeMove(
      createSenteMatingMovePosition({ moveNumber: 500 }),
      { row: 2, col: 4 },
      { row: 1, col: 4 },
      { promotion: 'decline' }
    );
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.result).toMatchObject({
      endReason: 'checkmate', winner: 'sente', loser: 'gote',
    });
    expect(result.state.moveLimitJishogi).toBeNull();
  });

  it('500手以降の待機中に成立した詰みも持将棋より優先する', () => {
    const result = executeMove(
      createSenteMatingMovePosition({
        moveNumber: 502,
        moveLimitJishogi: {
          kind: 'awaiting_continuous_check_end',
          checkingPlayer: 'sente',
        },
      }),
      { row: 2, col: 4 },
      { row: 1, col: 4 },
      { promotion: 'decline' }
    );
    expect(result.type).toBe('applied');
    if (result.type !== 'applied') return;
    expect(result.state.result?.endReason).toBe('checkmate');
    expect(result.state.moveLimitJishogi).toBeNull();
  });

  it('500手目に成立する連続王手の千日手を反則負けとして優先する', () => {
    const state = applySequence(
      createSenteCheckingPosition(489),
      [...senteCheckingCycle, ...senteCheckingCycle, ...senteCheckingCycle]
    );
    expect(state.moveNumber).toBe(501);
    expect(state.result).toMatchObject({
      endReason: 'foul_loss',
      loser: 'sente',
      foulReason: 'perpetual_check_repetition',
    });
  });

  it('500手目に成立する通常の千日手を無勝負として優先する', () => {
    const state = applySequence(
      createQuietKingPosition('sente', 489),
      [...kingCycle, ...kingCycle, ...kingCycle]
    );
    expect(state.moveNumber).toBe(501);
    expect(state.result).toMatchObject({
      endReason: 'repetition', winner: null, loser: null,
    });
  });

  it('終局済みの500手持将棋を再着手で変更しない', () => {
    const ended = applyMove(createQuietKingPosition('sente', 500), [8, 4, 8, 3]);
    const resultReference = ended.result;
    const retry = executeMove(ended, { row: 0, col: 4 }, { row: 0, col: 3 }, {
      mode: 'strict',
    });
    expect(retry.type).toBe('rejected');
    expect(retry.state).toBe(ended);
    expect(retry.state.result).toBe(resultReference);
  });

  it('投了と入玉宣言は500手待機や手数を着手として進めない', () => {
    const pending = applySequence(createSenteCheckingPosition(), [
      [1, 3, 1, 4],
      [0, 4, 0, 3],
    ]);
    const resignation = executeResignation(pending);
    expect(resignation.type).toBe('applied');
    expect(resignation.state.moveNumber).toBe(pending.moveNumber);
    expect(resignation.state.history).toBe(pending.history);
    expect(resignation.state.moveLimitJishogi).toBeNull();

    const declarationState = createQuietKingPosition('sente', 500);
    const declaration = executeEnteringKingDeclaration(declarationState);
    expect(declaration.type).toBe('rejected');
    expect(declaration.state).toBe(declarationState);
    expect(declaration.state.moveNumber).toBe(500);
  });

  it('500手持将棋のGameResult契約は勝者・敗者なしである', () => {
    const result = {
      winner: null,
      loser: null,
      endReason: 'five_hundred_move_jishogi',
    } satisfies GameResult;
    expect(result).toEqual({
      winner: null, loser: null, endReason: 'five_hundred_move_jishogi',
    });
  });
});

describe('500手持将棋のUI', () => {
  it('専用の終局理由をaria-live領域へ表示し、盤・駒台・終局操作を停止する', () => {
    const ended = applyMove(createQuietKingPosition('sente', 500), [8, 4, 8, 3]);
    render(<ShogiResearchScreen initialState={ended} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      '終局 / 500手規定による持将棋・無勝負'
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '入玉宣言' })).toBeDisabled();
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    expect(document.getElementById('piece-stand-gote')).toHaveAttribute('data-active', 'false');
  });

  it('500手目の王手直後も応手でき、501手目直後には終局しない', async () => {
    const user = userEvent.setup();
    const pending = applyMove(createSenteCheckingPosition(), [1, 3, 1, 4]);
    render(<ShogiResearchScreen initialState={pending} />);
    expect(screen.getByRole('status')).toHaveTextContent('王手 / 後手番');
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(81);
    await user.click(document.querySelector('[data-coordinate="5一"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="6一"]') as HTMLElement);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute(
      'data-move-number',
      '502'
    );
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(screen.getByRole('button', { name: '投了' })).toBeEnabled();
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'true');
  });

  it('フッターに500手規定への対応を表示する', () => {
    render(<ShogiResearchScreen />);
    expect(screen.getByText(/500手規定による持将棋の終局処理に対応/)).toBeInTheDocument();
  });
});
