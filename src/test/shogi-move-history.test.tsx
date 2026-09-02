import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MoveHistoryPanel } from '../components/shogi/MoveHistoryPanel';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import type { GameResult, MoveRecord, NormalMoveRecord } from '../types/shogi';
import { createInitialBoardState } from '../types/shogi';
import './shogi-replay.cases';

function createMove(
  moveNumber: number,
  notation: string,
  overrides: Partial<NormalMoveRecord> = {}
): NormalMoveRecord {
  return {
    kind: 'move',
    moveNumber,
    player: moveNumber % 2 === 1 ? 'sente' : 'gote',
    from: { row: 6, col: 2 },
    to: { row: 5, col: 2 },
    pieceType: 'pawn',
    capturedPieceType: null,
    promotion: 'none',
    notation,
    ...overrides,
  };
}

function createHistory(): MoveRecord[] {
  return [
    createMove(1, '▲7六歩'),
    createMove(2, '△3四歩'),
    createMove(15, '▲2二角成', {
      pieceType: 'bishop',
      promotion: 'promote',
    }),
    createMove(16, '△8八角不成', {
      player: 'gote',
      pieceType: 'bishop',
      promotion: 'decline',
    }),
    {
      kind: 'drop',
      moveNumber: 27,
      player: 'sente',
      from: null,
      to: { row: 4, col: 4 },
      pieceId: 'hand-pawn',
      pieceType: 'pawn',
      capturedPieceType: null,
      promotion: 'none',
      notation: '▲5五歩打',
    },
  ];
}

function mockMoveHistoryScrollHeight(value: number) {
  const scrollIntoView = vi.fn();
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView'
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  const scrollHeight = vi
    .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    .mockReturnValue(value);

  return {
    scrollIntoView,
    restore: () => {
      scrollHeight.mockRestore();
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    },
  };
}

describe('閲覧専用の棋譜一覧', () => {
  it('初期局面では見出し、ログ、空状態を意味的に表示する', () => {
    render(<MoveHistoryPanel history={[]} result={null} />);

    expect(screen.getByRole('heading', { name: '棋譜' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: '着手履歴' })).toHaveTextContent('まだ着手はありません');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('通常移動・成り・不成・駒打ちを配列順かつnotationのまま表示する', () => {
    const history = createHistory();
    const { rerender } = render(<MoveHistoryPanel history={history} result={null} />);

    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('1▲7六歩');
    expect(items[1]).toHaveTextContent('2△3四歩');
    expect(items[2]).toHaveTextContent('15▲2二角成');
    expect(items[3]).toHaveTextContent('16△8八角不成');
    expect(items[4]).toHaveTextContent('27▲5五歩打最新');

    const intentionallyDifferentFields = createMove(28, '△独自表記をそのまま表示', {
      player: 'gote',
      pieceType: 'rook',
      to: { row: 0, col: 0 },
    });
    rerender(<MoveHistoryPanel history={[intentionallyDifferentFields]} result={null} />);
    expect(screen.getByText('△独自表記をそのまま表示')).toBeInTheDocument();
  });

  it('最後の着手だけを最新手として識別し、追加時に対象を移す', () => {
    const first = createMove(1, '▲7六歩');
    const second = createMove(2, '△3四歩');
    const { rerender } = render(<MoveHistoryPanel history={[first]} result={null} />);

    expect(screen.getByRole('listitem')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('listitem')).toHaveAccessibleName('1手目 ▲7六歩 最新手');

    rerender(<MoveHistoryPanel history={[first, second]} result={null} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[1]).toHaveAccessibleName('2手目 △3四歩 最新手');
  });

  it('履歴追加と結果追加時にパネル内部のscrollTopだけを末尾へ追従させる', () => {
    const scrollMock = mockMoveHistoryScrollHeight(640);
    try {
      const first = createMove(1, '▲7六歩');
      const second = createMove(2, '△3四歩');
      const { rerender } = render(<MoveHistoryPanel history={[first]} result={null} />);
      const container = screen.getByTestId('move-history-scroll-container');
      expect(container.scrollTop).toBe(640);

      container.scrollTop = 20;
      rerender(<MoveHistoryPanel history={[first, second]} result={null} />);
      expect(container.scrollTop).toBe(640);

      container.scrollTop = 10;
      rerender(
        <MoveHistoryPanel
          history={[first, second]}
          result={{ winner: 'sente', loser: 'gote', endReason: 'checkmate' }}
        />
      );
      expect(container.scrollTop).toBe(640);
      expect(scrollMock.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      scrollMock.restore();
    }
  });

  it('閉じたモバイル棋譜を開く操作で長い履歴の末尾へ再追従する', async () => {
    const user = userEvent.setup();
    const scrollMock = mockMoveHistoryScrollHeight(720);
    try {
      render(<MoveHistoryPanel history={createHistory()} result={null} />);
      const container = screen.getByTestId('move-history-scroll-container');

      await user.click(screen.getByRole('button', { name: '棋譜を表示' }));
      await user.click(screen.getByRole('button', { name: '棋譜を閉じる' }));
      container.scrollTop = 0;

      await user.click(screen.getByRole('button', { name: '棋譜を表示' }));
      expect(container.scrollTop).toBe(720);
      expect(scrollMock.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      scrollMock.restore();
    }
  });

  it('終局結果があるモバイル棋譜も開く操作で末尾へ再追従する', async () => {
    const user = userEvent.setup();
    const scrollMock = mockMoveHistoryScrollHeight(840);
    try {
      render(
        <MoveHistoryPanel
          history={createHistory()}
          result={{ winner: 'sente', loser: 'gote', endReason: 'checkmate' }}
        />
      );
      const container = screen.getByTestId('move-history-scroll-container');
      container.scrollTop = 0;

      await user.click(screen.getByRole('button', { name: '棋譜を表示' }));
      expect(container.scrollTop).toBe(840);
      expect(screen.getByText('先手勝ち（詰み）')).toBeInTheDocument();
      expect(scrollMock.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      scrollMock.restore();
    }
  });

  it('モバイル開閉ボタンをパネルへ関連付け、開閉しても棋譜内容を維持する', async () => {
    const user = userEvent.setup();
    render(<MoveHistoryPanel history={createHistory()} result={null} />);

    const openButton = screen.getByRole('button', { name: '棋譜を表示' });
    expect(openButton).toHaveAttribute('aria-expanded', 'false');
    const panelId = openButton.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).toBeInTheDocument();

    await user.click(openButton);
    const closeButton = screen.getByRole('button', { name: '棋譜を閉じる' });
    expect(closeButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);

    await user.click(closeButton);
    expect(screen.getByRole('button', { name: '棋譜を表示' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('通常の盤面操作で生成されたnotationを棋譜へ接続する', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);

    await user.click(screen.getByRole('gridcell', { name: '7筋 7段、先手の歩兵' }));
    await user.click(screen.getByRole('gridcell', { name: '7筋 6段、空のマス、移動可能' }));

    expect(screen.getByRole('listitem', { name: '1手目 ▲7六歩 最新手' })).toBeInTheDocument();
  });
});

describe('棋譜パネルの終局結果', () => {
  const cases: ReadonlyArray<{ result: GameResult; text: string; draw?: boolean }> = [
    {
      result: { winner: 'sente', loser: 'gote', endReason: 'checkmate' },
      text: '先手勝ち（詰み）',
    },
    {
      result: { winner: 'gote', loser: 'sente', endReason: 'resignation' },
      text: '後手勝ち（先手投了）',
    },
    {
      result: {
        winner: 'gote',
        loser: 'sente',
        endReason: 'foul_loss',
        foulReason: 'nifu',
      },
      text: '後手勝ち（先手反則負け）',
    },
    {
      result: {
        winner: 'gote',
        loser: 'sente',
        endReason: 'foul_loss',
        foulReason: 'perpetual_check_repetition',
      },
      text: '後手勝ち（先手反則負け・連続王手の千日手）',
    },
    {
      result: { winner: null, loser: null, endReason: 'repetition' },
      text: '千日手（無勝負）',
      draw: true,
    },
    {
      result: { winner: null, loser: null, endReason: 'five_hundred_move_jishogi' },
      text: '500手規定による持将棋・無勝負',
      draw: true,
    },
    {
      result: {
        winner: null,
        loser: null,
        endReason: 'agreed_jishogi_draw',
        sentePoints: 25,
        gotePoints: 24,
      },
      text: '合意による持将棋・無勝負（先手25点・後手24点）',
      draw: true,
    },
    {
      result: {
        winner: 'sente',
        loser: 'gote',
        endReason: 'agreed_jishogi_point_loss',
        sentePoints: 27,
        gotePoints: 23,
      },
      text: '先手勝ち（後手の点数不足・合意による持将棋、先手27点・後手23点）',
    },
    {
      result: { winner: 'sente', loser: 'gote', endReason: 'entering_king_win' },
      text: '先手勝ち（入玉宣言）',
    },
    {
      result: { winner: null, loser: null, endReason: 'entering_king_draw' },
      text: '入玉宣言による無勝負',
      draw: true,
    },
    {
      result: {
        winner: 'gote',
        loser: 'sente',
        endReason: 'entering_king_declaration_failure',
      },
      text: '後手勝ち（先手の入玉宣言失敗）',
    },
  ];

  it.each(cases)('$result.endReasonを対局結果として表示する', ({ result, text, draw }) => {
    render(<MoveHistoryPanel history={createHistory()} result={result} />);
    const resultRegion = screen.getByRole('heading', { name: '対局結果' }).parentElement;
    expect(resultRegion).toHaveTextContent(text);
    if (draw) {
      expect(resultRegion).not.toHaveTextContent('勝ち');
    }
  });
});

describe('新しい対局との棋譜連携', () => {
  it('確認を開く・キャンセルでは維持し、確定時だけ棋譜と前局結果を消す', async () => {
    const user = userEvent.setup();
    const state = createInitialBoardState();
    state.history = [createMove(1, '▲7六歩')];
    state.lastMove = state.history[0];
    state.status = 'ended';
    state.result = { winner: 'sente', loser: 'gote', endReason: 'checkmate' };
    render(<ShogiResearchScreen initialState={state} />);

    const panel = document.getElementById('shogi-move-history-panel') as HTMLElement;
    const scrollContainer = screen.getByTestId('move-history-scroll-container');
    expect(within(panel).getByText('▲7六歩')).toBeInTheDocument();
    expect(within(panel).getByText('先手勝ち（詰み）')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '棋譜を表示' }));
    scrollContainer.scrollTop = 90;

    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    expect(within(panel).getByText('▲7六歩')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(within(panel).getByText('▲7六歩')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棋譜を閉じる' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(scrollContainer.scrollTop).toBe(90);

    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: '新しい対局を始める' }));
    expect(screen.getByRole('button', { name: '棋譜を表示' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(within(panel).getByText('まだ着手はありません')).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: '対局結果' })).not.toBeInTheDocument();
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it('空の初期局面でもキャンセルは開閉を維持し、確定だけ棋譜を閉じる', async () => {
    const user = userEvent.setup();
    render(<ShogiResearchScreen />);
    const panel = document.getElementById('shogi-move-history-panel') as HTMLElement;
    const scrollContainer = screen.getByTestId('move-history-scroll-container');

    await user.click(screen.getByRole('button', { name: '棋譜を表示' }));
    scrollContainer.scrollTop = 120;
    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    expect(screen.getByRole('button', { name: '棋譜を閉じる' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByRole('button', { name: '棋譜を閉じる' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(within(panel).getByText('まだ着手はありません')).toBeInTheDocument();
    expect(scrollContainer.scrollTop).toBe(120);

    await user.click(screen.getByRole('button', { name: '新しい対局' }));
    await user.click(screen.getByRole('button', { name: '新しい対局を始める' }));
    expect(screen.getByRole('button', { name: '棋譜を表示' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(within(panel).getByText('まだ着手はありません')).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: '対局結果' })).not.toBeInTheDocument();
    expect(scrollContainer.scrollTop).toBe(0);
  });

  it('棋譜の開閉は盤面選択と棋譜内容を変更しない', async () => {
    const user = userEvent.setup();
    const state = createInitialBoardState();
    state.history = [createMove(1, '▲7六歩')];
    state.lastMove = state.history[0];
    render(<ShogiResearchScreen initialState={state} />);

    const square = screen.getByRole('gridcell', { name: '7筋 7段、先手の歩兵' });
    await user.click(square);
    expect(square).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: '棋譜を表示' }));
    expect(square).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('▲7六歩')).toBeInTheDocument();
  });
});
