import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import {
  createInitialBoardState,
  getSquareAriaLabel,
  getPieceDisplayInfo,
  canPromote,
  BoardSquare,
} from '../types/shogi';
import { ShogiBoard } from '../components/shogi/ShogiBoard';

describe('1. npm・環境・設定ファイルの検証', () => {
  const rootDir = process.cwd();
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf-8'));
  const packageLockJson = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'package-lock.json'), 'utf-8')
  );

  it('package.json の名前が shogi-app であること', () => {
    expect(packageJson.name).toBe('shogi-app');
  });

  it('packageManager が npm を指定していること', () => {
    expect(packageJson.packageManager).toMatch(/^npm@\d+\.\d+\.\d+/);
  });

  it('Node.js の engines が指定されていること', () => {
    expect(packageJson.engines).toBeDefined();
    expect(packageJson.engines.node).toBe('>=20.0.0');
    expect(packageJson.engines.npm).toBe('>=10.0.0');
  });

  it('package-lock.json が存在しルート名が shogi-app であること', () => {
    expect(fs.existsSync(path.resolve(rootDir, 'package-lock.json'))).toBe(true);
    expect(packageLockJson.name).toBe('shogi-app');
  });

  it('bun.lock が存在しないこと', () => {
    expect(fs.existsSync(path.resolve(rootDir, 'bun.lock'))).toBe(false);
  });

  it('clean スクリプトが rm -rf に依存せずクロスプラットフォームスクリプトを呼び出していること', () => {
    expect(packageJson.scripts.clean).toBe('node scripts/clean.mjs');
    expect(fs.existsSync(path.resolve(rootDir, 'scripts/clean.mjs'))).toBe(true);
  });
});

describe('2. 将棋盤および駒のデータ・表示ロジック（既存基本要件）', () => {
  it('盤面が9行×9列である', () => {
    const boardState = createInitialBoardState();
    expect(boardState.squares).toHaveLength(9);
    for (const row of boardState.squares) {
      expect(row).toHaveLength(9);
    }
  });

  it('初期配置の駒が合計40枚である', () => {
    const boardState = createInitialBoardState();
    let pieceCount = 0;
    for (const row of boardState.squares) {
      for (const sq of row) {
        if (sq.piece) pieceCount++;
      }
    }
    expect(pieceCount).toBe(40);
  });

  it('全駒のIDが重複していない', () => {
    const boardState = createInitialBoardState();
    const ids = new Set<string>();
    for (const row of boardState.squares) {
      for (const sq of row) {
        if (sq.piece) {
          expect(ids.has(sq.piece.id)).toBe(false);
          ids.add(sq.piece.id);
        }
      }
    }
    expect(ids.size).toBe(40);
  });

  it('後手の飛車が8二、角が2二にある', () => {
    const boardState = createInitialBoardState();
    const square82 = boardState.squares[1][1];
    expect(square82.coordinateLabel).toBe('8二');
    expect(square82.piece?.player).toBe('gote');
    expect(square82.piece?.type).toBe('rook');

    const square22 = boardState.squares[1][7];
    expect(square22.coordinateLabel).toBe('2二');
    expect(square22.piece?.player).toBe('gote');
    expect(square22.piece?.type).toBe('bishop');
  });

  it('先手の角が8八、飛車が2八にある', () => {
    const boardState = createInitialBoardState();
    const square88 = boardState.squares[7][1];
    expect(square88.coordinateLabel).toBe('8八');
    expect(square88.piece?.player).toBe('sente');
    expect(square88.piece?.type).toBe('bishop');

    const square28 = boardState.squares[7][7];
    expect(square28.coordinateLabel).toBe('2八');
    expect(square28.piece?.player).toBe('sente');
    expect(square28.piece?.type).toBe('rook');
  });

  it('先手王が5九、後手玉が5一にある', () => {
    const boardState = createInitialBoardState();
    const square59 = boardState.squares[8][4];
    expect(square59.coordinateLabel).toBe('5九');
    expect(square59.piece?.player).toBe('sente');
    expect(square59.piece?.type).toBe('king');

    const square51 = boardState.squares[0][4];
    expect(square51.coordinateLabel).toBe('5一');
    expect(square51.piece?.player).toBe('gote');
    expect(square51.piece?.type).toBe('king');
  });

  it('5九のARIA名称が「先手の王将」になる', () => {
    const boardState = createInitialBoardState();
    const square59 = boardState.squares[8][4];
    expect(getSquareAriaLabel(square59)).toBe('5筋 9段、先手の王将');
  });

  it('5一のARIA名称が「後手の玉将」になる', () => {
    const boardState = createInitialBoardState();
    const square51 = boardState.squares[0][4];
    expect(getSquareAriaLabel(square51)).toBe('5筋 1段、後手の玉将');
  });

  it('空マスのARIA名称が正しい', () => {
    const boardState = createInitialBoardState();
    const square45 = boardState.squares[4][5];
    expect(square45.piece).toBeNull();
    expect(getSquareAriaLabel(square45)).toBe('4筋 5段、空のマス');
  });

  it('各成駒が通常駒とは異なる正しい文字になる', () => {
    expect(canPromote('king')).toBe(false);
    expect(canPromote('gold')).toBe(false);

    const rookPromoted = getPieceDisplayInfo('rook', 'sente', true);
    expect(rookPromoted.fullName).toBe('竜王');
    expect(rookPromoted.topChar).toBe('竜');
    expect(rookPromoted.bottomChar).toBe('王');
    expect(rookPromoted.ariaName).toBe('先手の竜王');
    expect(rookPromoted.isPromotedColor).toBe(true);

    const bishopPromoted = getPieceDisplayInfo('bishop', 'sente', true);
    expect(bishopPromoted.fullName).toBe('竜馬');

    const silverPromoted = getPieceDisplayInfo('silver', 'sente', true);
    expect(silverPromoted.fullName).toBe('成銀');

    const knightPromoted = getPieceDisplayInfo('knight', 'sente', true);
    expect(knightPromoted.fullName).toBe('成桂');

    const lancePromoted = getPieceDisplayInfo('lance', 'sente', true);
    expect(lancePromoted.fullName).toBe('成香');

    const pawnPromoted = getPieceDisplayInfo('pawn', 'sente', true);
    expect(pawnPromoted.fullName).toBe('と金');
  });

  it('盤上の星が4個だけで、3/9・6/9の対称位置にある', () => {
    const boardState = createInitialBoardState();
    let starCount = 0;
    const starCoordinates: Array<{ row: number; col: number; coordinate: string }> = [];

    boardState.squares.forEach((rowSquares, row) => {
      rowSquares.forEach((sq, col) => {
        if (sq.hasBottomRightStarMarker) {
          starCount++;
          starCoordinates.push({ row, col, coordinate: sq.coordinateLabel });
        }
      });
    });

    expect(starCount).toBe(4);
    expect(starCoordinates).toEqual([
      { row: 2, col: 2, coordinate: '7三' },
      { row: 2, col: 5, coordinate: '4三' },
      { row: 5, col: 2, coordinate: '7六' },
      { row: 5, col: 5, coordinate: '4六' },
    ]);
  });
});

describe('3. 表示専用盤面のアクセシビリティ検証', () => {
  it('tabIndex={0} のマスが0個であり、role="grid", role="row" (9個), role="gridcell" (81個) が構築されること', () => {
    const boardState = createInitialBoardState();
    const { container } = render(<ShogiBoard squares={boardState.squares} />);

    // tabIndex 0 を持つ要素がない
    const focusable = container.querySelectorAll('[tabindex="0"]');
    expect(focusable.length).toBe(0);

    // grid 構造の確認
    const grid = container.querySelector('[role="grid"]');
    expect(grid).toBeInTheDocument();

    const rows = container.querySelectorAll('[role="row"]');
    expect(rows.length).toBe(9);

    const cells = container.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(81);
  });
});

describe('4. インタラクティブ盤面の roving tabindex およびキーボード操作検証', () => {
  it('初期状態で tabIndex={0} が1個、tabIndex={-1} が80個であること（既定初期位置: 7七）', () => {
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    const tabZeros = container.querySelectorAll('[tabindex="0"]');
    const tabMinusOnes = container.querySelectorAll('[tabindex="-1"]');

    expect(tabZeros.length).toBe(1);
    expect(tabMinusOnes.length).toBe(80);

    // 既定の初期フォーカス位置は 7七 (row 6, col 2)
    const defaultFocused = container.querySelector('#square-7七');
    expect(defaultFocused).toHaveAttribute('tabindex', '0');
  });

  it('selectedSquare が指定された場合、そのマスが tabIndex={0} となること', () => {
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard
        squares={boardState.squares}
        selectedSquare={{ row: 8, col: 4 }} // 5九（先手王将）
        onSquareClick={handleClick}
      />
    );

    const tabZeros = container.querySelectorAll('[tabindex="0"]');
    expect(tabZeros.length).toBe(1);
    const selectedSq = container.querySelector('#square-5九');
    expect(selectedSq).toHaveAttribute('tabindex', '0');
    expect(selectedSq).toHaveAttribute('aria-selected', 'true');
  });

  it('矢印キー（右・左・上・下）で隣接マスへフォーカス移動し、盤端で盤外へ出ないこと', async () => {
    const user = userEvent.setup();
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    // 初期フォーカス位置: 7七 (row 6, col 2)
    const square77 = container.querySelector('#square-7七') as HTMLElement;
    square77.focus();
    expect(square77).toHaveFocus();

    // 1. 右矢印キー -> 6七 (row 6, col 3)
    await user.keyboard('{ArrowRight}');
    const square67 = container.querySelector('#square-6七') as HTMLElement;
    expect(square67).toHaveFocus();
    expect(square67).toHaveAttribute('tabindex', '0');
    expect(square77).toHaveAttribute('tabindex', '-1');

    // 2. 上矢印キー -> 6六 (row 5, col 3)
    await user.keyboard('{ArrowUp}');
    const square66 = container.querySelector('#square-6六') as HTMLElement;
    expect(square66).toHaveFocus();
    expect(square66).toHaveAttribute('tabindex', '0');

    // 3. 左矢印キー -> 7六 (row 5, col 2)
    await user.keyboard('{ArrowLeft}');
    const square76 = container.querySelector('#square-7六') as HTMLElement;
    expect(square76).toHaveFocus();

    // 4. 下矢印キー -> 7七 (row 6, col 2)
    await user.keyboard('{ArrowDown}');
    expect(square77).toHaveFocus();

    // 5. 盤端テスト: 9一 (row 0, col 0) に移動してさらに上・左を押しても盤外へ出ない
    const square91 = container.querySelector('#square-9一') as HTMLElement;
    square91.focus();
    // クリックまたはフォーカスでroving tabindexが更新される
    await user.click(square91);
    expect(square91).toHaveAttribute('tabindex', '0');

    await user.keyboard('{ArrowUp}');
    expect(square91).toHaveFocus(); // 上端で位置維持

    await user.keyboard('{ArrowLeft}');
    expect(square91).toHaveFocus(); // 左端で位置維持
  });

  it('Enter キーおよび Space キーで対象マスのコールバックが1回ずつ呼ばれること', async () => {
    const user = userEvent.setup();
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    const square77 = container.querySelector('#square-7七') as HTMLElement;
    square77.focus();

    // Enter
    await user.keyboard('{Enter}');
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick.mock.calls[0][0].coordinateLabel).toBe('7七');

    // Space
    await user.keyboard(' ');
    expect(handleClick).toHaveBeenCalledTimes(2);
    expect(handleClick.mock.calls[1][0].coordinateLabel).toBe('7七');
  });

  it('マウスクリックしたマスが roving tabindex の現在位置（tabIndex={0}）になること', async () => {
    const user = userEvent.setup();
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();
    const { container } = render(
      <ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />
    );

    const square28 = container.querySelector('#square-2八') as HTMLElement;
    await user.click(square28);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(square28).toHaveAttribute('tabindex', '0');

    // 他のマスは -1
    const square77 = container.querySelector('#square-7七') as HTMLElement;
    expect(square77).toHaveAttribute('tabindex', '-1');
  });

  it('表示専用からインタラクティブへの切り替え、およびその逆で Tab 停止数が正しく遷移すること', () => {
    const boardState = createInitialBoardState();
    const handleClick = vi.fn();

    // 1. 表示専用
    const { container, rerender } = render(<ShogiBoard squares={boardState.squares} />);
    expect(container.querySelectorAll('[tabindex="0"]').length).toBe(0);

    // 2. インタラクティブへ切り替え
    rerender(<ShogiBoard squares={boardState.squares} onSquareClick={handleClick} />);
    expect(container.querySelectorAll('[tabindex="0"]').length).toBe(1);
    expect(container.querySelectorAll('[tabindex="-1"]').length).toBe(80);

    // 3. 再び表示専用へ切り替え
    rerender(<ShogiBoard squares={boardState.squares} />);
    expect(container.querySelectorAll('[tabindex="0"]').length).toBe(0);
    expect(container.querySelectorAll('[tabindex="-1"]').length).toBe(0);
  });
});
