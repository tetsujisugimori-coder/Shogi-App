import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import * as shogiDomain from '../domain/shogi';
import {
  calculateEnteringKingPoints,
  cloneBoardSquares,
  countEnteringKingCampPieces,
  evaluateEnteringKingDeclaration,
  executeEnteringKingDeclaration,
  isInEnemyCamp,
} from '../domain/shogi';
import type {
  BoardState,
  BoardStatus,
  GameResult,
  Piece,
  PieceType,
  Player,
} from '../types/shogi';
import { createInitialBoardState } from '../types/shogi';

interface Placement {
  row: number;
  col: number;
  piece: Piece;
}

function piece(id: string, type: PieceType, player: Player, isPromoted = false): Piece {
  return { id, type, player, ...(isPromoted ? { isPromoted: true } : {}) };
}

function createEmptyPosition(
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
  return { ...initial, squares, turn, ...overrides };
}

function createCampPieces(player: Player, count = 10): Placement[] {
  const rows = player === 'sente' ? [1, 2] : [7, 6];
  const placements: Placement[] = [];
  for (let index = 0; index < count; index += 1) {
    placements.push({
      row: rows[Math.floor(index / 8)],
      col: (index % 8) + 1,
      piece: piece(`${player}-camp-${index}`, 'pawn', player, index === 0),
    });
  }
  return placements;
}

function handForAdditionalPoints(player: Player, points: number): Piece[] {
  const hand: Piece[] = [];
  let remaining = points;
  let majorIndex = 0;
  while (remaining >= 5 && majorIndex < 4) {
    hand.push(piece(`${player}-hand-major-${majorIndex}`, majorIndex % 2 === 0 ? 'rook' : 'bishop', player));
    remaining -= 5;
    majorIndex += 1;
  }
  for (let index = 0; index < remaining; index += 1) {
    hand.push(piece(`${player}-hand-small-${index}`, 'silver', player));
  }
  return hand;
}

function createEligiblePosition(
  player: Player,
  points: number,
  overrides: Partial<BoardState> = {}
): BoardState {
  const kingRow = player === 'sente' ? 0 : 8;
  const opponent: Player = player === 'sente' ? 'gote' : 'sente';
  const opponentKingRow = player === 'sente' ? 8 : 0;
  const state = createEmptyPosition(
    player,
    [
      { row: kingRow, col: 0, piece: piece(`${player}-king`, 'king', player) },
      ...createCampPieces(player),
      { row: opponentKingRow, col: 8, piece: piece(`${opponent}-king`, 'king', opponent) },
    ],
    overrides
  );
  const hand = handForAdditionalPoints(player, points - 10);
  return player === 'sente' ? { ...state, senteHand: hand } : { ...state, goteHand: hand };
}

describe('入玉宣言の敵陣・点数・枚数計算', () => {
  it.each([
    ['sente', 0, true], ['sente', 2, true], ['sente', 3, false],
    ['gote', 5, false], ['gote', 6, true], ['gote', 8, true],
  ] as const)('%sのrow %sの敵陣判定は%s', (player, row, expected) => {
    expect(isInEnemyCamp(player, row)).toBe(expected);
  });

  it.each(['sente', 'gote'] as const)('%sを先後対称に31点と数える', (player) => {
    expect(calculateEnteringKingPoints(createEligiblePosition(player, 31), player)).toBe(31);
  });

  it.each([
    ['rook', false, 5], ['bishop', false, 5], ['rook', true, 5], ['bishop', true, 5],
    ['gold', false, 1], ['silver', false, 1], ['knight', false, 1], ['lance', false, 1],
    ['pawn', false, 1], ['silver', true, 1], ['knight', true, 1], ['lance', true, 1],
    ['pawn', true, 1], ['king', false, 0],
  ] as const)('%s（成り=%s）は%s点', (type, isPromoted, expected) => {
    const state = createEmptyPosition('sente', [
      { row: 0, col: 0, piece: piece('target', type, 'sente', isPromoted) },
    ]);
    expect(calculateEnteringKingPoints(state, 'sente')).toBe(expected);
  });

  it('持ち駒と敵陣内の自駒だけを数え、敵陣外と相手駒を除外する', () => {
    const state = createEmptyPosition('sente', [
      { row: 0, col: 0, piece: piece('camp-rook', 'rook', 'sente') },
      { row: 3, col: 0, piece: piece('outside-rook', 'rook', 'sente') },
      { row: 1, col: 1, piece: piece('enemy-rook', 'rook', 'gote') },
    ], {
      senteHand: [piece('hand-bishop', 'bishop', 'sente')],
      goteHand: [piece('enemy-hand-rook', 'rook', 'gote')],
    });
    expect(calculateEnteringKingPoints(state, 'sente')).toBe(10);
  });

  it('同じ駒を二重に数えず、持ち駒の順序とIDは点数に影響しない', () => {
    const state = createEmptyPosition('sente', [
      { row: 0, col: 0, piece: piece('board-rook', 'rook', 'sente') },
    ], {
      senteHand: [piece('a', 'bishop', 'sente'), piece('b', 'pawn', 'sente')],
    });
    const reordered: BoardState = {
      ...state,
      senteHand: [piece('changed-b', 'pawn', 'sente'), piece('changed-a', 'bishop', 'sente')],
    };
    expect(calculateEnteringKingPoints(state)).toBe(11);
    expect(calculateEnteringKingPoints(reordered)).toBe(11);
  });

  it('点数・枚数計算と評価は入力stateを変更しない', () => {
    const state = createEligiblePosition('sente', 31);
    const snapshot = JSON.stringify(state);
    calculateEnteringKingPoints(state);
    countEnteringKingCampPieces(state);
    evaluateEnteringKingDeclaration(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it.each([[10, 10], [9, 9]] as const)('敵陣内%s枚を%s枚と数える', (count, expected) => {
    const state = createEmptyPosition('sente', [
      { row: 0, col: 0, piece: piece('king', 'king', 'sente') },
      ...createCampPieces('sente', count),
    ], { senteHand: [piece('hand', 'pawn', 'sente')] });
    expect(countEnteringKingCampPieces(state)).toBe(expected);
  });

  it('枚数には玉・持ち駒・敵陣外の駒を含めず、成駒も1枚と数える', () => {
    const state = createEmptyPosition('sente', [
      { row: 0, col: 0, piece: piece('king', 'king', 'sente') },
      { row: 1, col: 1, piece: piece('promoted', 'rook', 'sente', true) },
      { row: 3, col: 2, piece: piece('outside', 'pawn', 'sente') },
    ], { senteHand: [piece('hand', 'pawn', 'sente')] });
    expect(countEnteringKingCampPieces(state)).toBe(1);
  });
});

describe('入玉宣言の条件評価', () => {
  it.each([
    ['sente', 0, true], ['sente', 2, true], ['sente', 3, false],
    ['gote', 8, true], ['gote', 6, true], ['gote', 5, false],
  ] as const)('%s玉がrow %sなら入玉=%s', (player, kingRow, expected) => {
    const state = createEligiblePosition(player, 31);
    const currentKingRow = player === 'sente' ? 0 : 8;
    state.squares[kingRow][0].piece = state.squares[currentKingRow][0].piece;
    if (kingRow !== currentKingRow) state.squares[currentKingRow][0].piece = null;
    expect(evaluateEnteringKingDeclaration(state).isKingInEnemyCamp).toBe(expected);
  });

  it('玉がない不整合局面を安全に不成立とする', () => {
    const state = createEligiblePosition('sente', 31);
    state.squares[0][0].piece = null;
    expect(evaluateEnteringKingDeclaration(state)).toMatchObject({
      kingExists: false,
      isKingInEnemyCamp: false,
      isKingNotInCheck: false,
      outcome: 'ineligible',
      reasons: expect.arrayContaining(['king_missing']),
    });
  });

  it('王手中は宣言不成立とする', () => {
    const state = createEligiblePosition('sente', 31);
    state.squares[4][0].piece = piece('checking-rook', 'rook', 'gote');
    const evaluation = evaluateEnteringKingDeclaration(state);
    expect(evaluation.isKingNotInCheck).toBe(false);
    expect(evaluation.reasons).toContain('king_in_check');
    expect(evaluation.outcome).toBe('ineligible');
  });

  it.each(['preparation', 'blunder', 'evaluating', 'ended'] as const)(
    '%sでは対局中条件を満たさない',
    (status: BoardStatus) => {
      const evaluation = evaluateEnteringKingDeclaration(createEligiblePosition('sente', 31, { status }));
      expect(evaluation.isGameInProgress).toBe(false);
      expect(evaluation.reasons).toContain('game_not_in_progress');
    }
  );

  it('敵陣内10枚は成立し9枚は不足理由を返す', () => {
    expect(evaluateEnteringKingDeclaration(createEligiblePosition('sente', 31)).campPieceCount).toBe(10);
    const state = createEligiblePosition('sente', 31);
    state.squares[2][2].piece = null;
    const evaluation = evaluateEnteringKingDeclaration(state);
    expect(evaluation.campPieceCount).toBe(9);
    expect(evaluation.reasons).toContain('insufficient_camp_pieces');
  });

  it.each([
    [23, 'ineligible'], [24, 'draw'], [30, 'draw'], [31, 'win'], [32, 'win'],
  ] as const)('%s点の境界判定は%s', (points, outcome) => {
    expect(evaluateEnteringKingDeclaration(createEligiblePosition('sente', points))).toMatchObject({
      points,
      outcome,
    });
  });

  it.each(['sente', 'gote'] as const)('%sにも同じ24点・31点境界を使う', (player) => {
    expect(evaluateEnteringKingDeclaration(createEligiblePosition(player, 24)).outcome).toBe('draw');
    expect(evaluateEnteringKingDeclaration(createEligiblePosition(player, 31)).outcome).toBe('win');
  });

  it('moveNumberは次の手番号で、完了499手は500手未満として扱う', () => {
    const evaluation = evaluateEnteringKingDeclaration(createEligiblePosition('sente', 31, { moveNumber: 500 }));
    expect(evaluation.completedMoves).toBe(499);
    expect(evaluation.isBeforeMoveLimit).toBe(true);
  });

  it('moveNumber 501は完了500手として宣言不可にする', () => {
    const evaluation = evaluateEnteringKingDeclaration(createEligiblePosition('sente', 31, {
      moveNumber: 501,
      history: [],
    }));
    expect(evaluation.completedMoves).toBe(500);
    expect(evaluation.isBeforeMoveLimit).toBe(false);
    expect(evaluation.reasons).toContain('move_limit_reached');
  });
});

describe('入玉宣言実行API', () => {
  it('assistで条件不足なら同じstateを返して対局を継続する', () => {
    const state = createInitialBoardState();
    const execution = executeEnteringKingDeclaration(state, { mode: 'assist' });
    expect(execution.type).toBe('rejected');
    expect(execution.state).toBe(state);
    expect(execution.state.status).toBe('active');
  });

  it('strictで条件不足なら現在手番側の宣言失敗負けとして終局する', () => {
    const state = createInitialBoardState();
    const execution = executeEnteringKingDeclaration(state, { mode: 'strict' });
    expect(execution.type).toBe('declaration_failure');
    if (execution.type !== 'declaration_failure') return;
    expect(execution.result).toEqual({
      winner: 'gote', loser: 'sente',
      endReason: 'entering_king_declaration_failure',
      details: '先手の入玉宣言失敗',
    });
  });

  it('strict失敗でも局面・全履歴・手番・手数の参照と内容を維持する', () => {
    const state = createInitialBoardState();
    const snapshot = JSON.stringify(state);
    const execution = executeEnteringKingDeclaration(state, { mode: 'strict' });
    expect(execution.type).toBe('declaration_failure');
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(execution.state.squares).toBe(state.squares);
    expect(execution.state.senteHand).toBe(state.senteHand);
    expect(execution.state.goteHand).toBe(state.goteHand);
    expect(execution.state.turn).toBe(state.turn);
    expect(execution.state.moveNumber).toBe(state.moveNumber);
    expect(execution.state.history).toBe(state.history);
    expect(execution.state.lastMove).toBe(state.lastMove);
    expect(execution.state.positionHistory).toBe(state.positionHistory);
    expect(execution.state.foulHistory).toBe(state.foulHistory);
  });

  it('31点以上では宣言者勝ちにする', () => {
    const execution = executeEnteringKingDeclaration(createEligiblePosition('gote', 31));
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;
    expect(execution.result).toMatchObject({
      winner: 'gote', loser: 'sente', endReason: 'entering_king_win',
    });
  });

  it('24～30点では勝者・敗者なしの無勝負にする', () => {
    const execution = executeEnteringKingDeclaration(createEligiblePosition('sente', 24));
    expect(execution.type).toBe('applied');
    if (execution.type !== 'applied') return;
    expect(execution.result).toEqual({
      winner: null, loser: null, endReason: 'entering_king_draw',
      details: '入玉宣言による無勝負',
    });
  });

  it.each([31, 24])('成功時もMove/Foul/局面履歴を追加せず盤面・手番・手数を変えない（%s点）', (points) => {
    const state = createEligiblePosition('sente', points);
    const execution = executeEnteringKingDeclaration(state);
    expect(execution.type).toBe('applied');
    expect(execution.state.squares).toBe(state.squares);
    expect(execution.state.senteHand).toBe(state.senteHand);
    expect(execution.state.turn).toBe(state.turn);
    expect(execution.state.moveNumber).toBe(state.moveNumber);
    expect(execution.state.history).toBe(state.history);
    expect(execution.state.lastMove).toBe(state.lastMove);
    expect(execution.state.positionHistory).toBe(state.positionHistory);
    expect(execution.state.foulHistory).toBe(state.foulHistory);
  });

  it('終局済みstateの既存結果を上書きしない', () => {
    const result = { winner: 'sente', loser: 'gote', endReason: 'checkmate' } satisfies GameResult;
    const state = createEligiblePosition('sente', 31, { status: 'ended', result });
    const execution = executeEnteringKingDeclaration(state, { mode: 'strict' });
    expect(execution.type).toBe('rejected');
    if (execution.type !== 'rejected') return;
    expect(execution.reason).toBe('game_already_ended');
    expect(execution.state).toBe(state);
    expect(execution.state.result).toBe(result);
  });

  it.each(['preparation', 'blunder', 'evaluating'] as const)('%sは専用理由で拒否する', (status) => {
    const state = createEligiblePosition('sente', 31, { status });
    const execution = executeEnteringKingDeclaration(state, { mode: 'strict' });
    expect(execution).toMatchObject({
      type: 'rejected', reason: 'entering_king_declaration_not_available', state,
    });
  });

  it.each([
    [undefined, undefined, 'rejected'],
    ['human', undefined, 'rejected'],
    ['local_ai', undefined, 'declaration_failure'],
    ['shogi_engine', undefined, 'declaration_failure'],
    ['local_ai', 'assist', 'rejected'],
    ['human', 'strict', 'declaration_failure'],
  ] as const)('proposer=%s mode=%sの結果は%s', (proposer, mode, expected) => {
    const execution = executeEnteringKingDeclaration(createInitialBoardState(), {
      ...(proposer ? { proposer } : {}),
      ...(mode ? { mode } : {}),
    });
    expect(execution.type).toBe(expected);
  });

  it('評価・点数・実行関数を公開APIから利用できる', () => {
    expect(shogiDomain.evaluateEnteringKingDeclaration).toBe(evaluateEnteringKingDeclaration);
    expect(shogiDomain.calculateEnteringKingPoints).toBe(calculateEnteringKingPoints);
    expect(shogiDomain.executeEnteringKingDeclaration).toBe(executeEnteringKingDeclaration);
  });
});

describe('入玉宣言確認UIと終局表示', () => {
  it('入玉宣言ボタンと条件不足の評価を表示し、確定を無効化する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '入玉宣言' }));
    const dialog = screen.getByRole('dialog', { name: '入玉宣言を確認' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'entering-king-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(within(dialog).getByText(/宣言者は先手/)).toBeInTheDocument();
    expect(within(dialog).getByText('0枚 / 必要10枚')).toBeInTheDocument();
    expect(within(dialog).getByText('0点')).toBeInTheDocument();
    expect(within(dialog).getByText('判定：宣言条件不足')).toBeInTheDocument();
    expect(within(dialog).getByText(/玉が敵陣3段目以内に入っていません/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '宣言する' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveFocus();
  });

  it.each([
    [31, '判定：宣言勝ち', '終局 / 先手勝ち（入玉宣言）'],
    [24, '判定：無勝負', '終局 / 入玉宣言による無勝負'],
  ] as const)('%s点の評価を表示して正しく終局する', async (points, decision, status) => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createEligiblePosition('sente', points)} />);
    await user.click(screen.getByRole('button', { name: '入玉宣言' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('10枚 / 必要10枚')).toBeInTheDocument();
    expect(within(dialog).getByText(`${points}点`)).toBeInTheDocument();
    expect(within(dialog).getByText(decision)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '宣言する' }));
    expect(screen.getByRole('status')).toHaveTextContent(status);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it.each(['button', 'escape', 'backdrop'] as const)('%sでキャンセルし状態を変えずフォーカスを戻す', async (method) => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const declarationButton = screen.getByRole('button', { name: '入玉宣言' });
    await user.click(declarationButton);
    if (method === 'button') await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    if (method === 'escape') await user.keyboard('{Escape}');
    if (method === 'backdrop') fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(declarationButton).toHaveFocus();
  });

  it('有効時はTabとShift+Tabでフォーカスを循環する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen initialState={createEligiblePosition('sente', 31)} />);
    await user.click(screen.getByRole('button', { name: '入玉宣言' }));
    const cancel = screen.getByRole('button', { name: 'キャンセル' });
    const confirm = screen.getByRole('button', { name: '宣言する' });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it('ダイアログ中は盤・駒台・投了・入玉宣言を操作できない', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const source = document.querySelector('[data-coordinate="7七"]') as HTMLElement;
    const destination = document.querySelector('[data-coordinate="7六"]') as HTMLElement;
    await user.click(source);
    await user.click(screen.getByRole('button', { name: '入玉宣言' }));
    expect(screen.getByRole('button', { name: '入玉宣言' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
    await user.click(destination);
    expect(document.getElementById('shogi-research-screen')).toHaveAttribute('data-history-count', '0');
  });

  it('投了確認中は入玉宣言を無効化し、両ダイアログを競合させない', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    await user.click(screen.getByRole('button', { name: '投了' }));
    expect(screen.getByRole('button', { name: '入玉宣言' })).toBeDisabled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('成り選択中は入玉宣言を無効化する', async () => {
    const user = userEvent.setup();
    const state = createEmptyPosition('sente', [
      { row: 8, col: 8, piece: piece('sente-king', 'king', 'sente') },
      { row: 0, col: 0, piece: piece('gote-king', 'king', 'gote') },
      { row: 3, col: 4, piece: piece('rook', 'rook', 'sente') },
    ]);
    render(<ShogiResearchScreen initialState={state} />);
    await user.click(document.querySelector('[data-coordinate="5四"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="5三"]') as HTMLElement);
    expect(screen.getByRole('dialog', { name: '成り選択' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '入玉宣言' })).toBeDisabled();
  });

  it.each([
    [{ winner: 'sente', loser: 'gote', endReason: 'entering_king_win' } satisfies GameResult,
      '終局 / 先手勝ち（入玉宣言）'],
    [{ winner: null, loser: null, endReason: 'entering_king_draw' } satisfies GameResult,
      '終局 / 入玉宣言による無勝負'],
    [{ winner: 'gote', loser: 'sente', endReason: 'entering_king_declaration_failure' } satisfies GameResult,
      '終局 / 先手敗け（入玉宣言失敗）'],
  ] as const)('入玉結果を表示し終局操作を停止する', (result, status) => {
    const state = createInitialBoardState();
    render(<ShogiResearchScreen initialState={{ ...state, status: 'ended', result }} />);
    expect(screen.getByRole('status')).toHaveTextContent(status);
    expect(screen.getByRole('button', { name: '投了' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '入玉宣言' })).toBeDisabled();
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(document.getElementById('piece-stand-sente')).toHaveAttribute('data-active', 'false');
  });

  it('入玉宣言対応をフッターに表示する', () => {
    render(<ShogiResearchScreen />);
    expect(screen.getByText(/入玉宣言による終局処理に対応/)).toBeInTheDocument();
  });
});
