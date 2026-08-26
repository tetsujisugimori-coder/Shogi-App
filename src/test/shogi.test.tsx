import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import {
  createInitialBoardState,
  getSquareAriaLabel,
  getPieceDisplayInfo,
  canPromote,
  PieceType,
} from '../types/shogi';
import { ShogiBoard } from '../components/shogi/ShogiBoard';

describe('将棋盤および駒のデータ・表示ロジックのテスト', () => {
  it('1. 盤面が9行×9列である', () => {
    const boardState = createInitialBoardState();
    expect(boardState.squares).toHaveLength(9);
    for (const row of boardState.squares) {
      expect(row).toHaveLength(9);
    }
  });

  it('2. 初期配置の駒が合計40枚である', () => {
    const boardState = createInitialBoardState();
    let pieceCount = 0;
    for (const row of boardState.squares) {
      for (const sq of row) {
        if (sq.piece) pieceCount++;
      }
    }
    expect(pieceCount).toBe(40);
  });

  it('3. 全駒のIDが重複していない', () => {
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

  it('4. 後手の飛車が8二、角が2二にある', () => {
    const boardState = createInitialBoardState();
    // 8二: col = 1 (file 8), row = 1 (rank 2)
    const square82 = boardState.squares[1][1];
    expect(square82.coordinateLabel).toBe('8二');
    expect(square82.piece).not.toBeNull();
    expect(square82.piece?.player).toBe('gote');
    expect(square82.piece?.type).toBe('rook');

    // 2二: col = 7 (file 2), row = 1 (rank 2)
    const square22 = boardState.squares[1][7];
    expect(square22.coordinateLabel).toBe('2二');
    expect(square22.piece).not.toBeNull();
    expect(square22.piece?.player).toBe('gote');
    expect(square22.piece?.type).toBe('bishop');
  });

  it('5. 先手の角が8八、飛車が2八にある', () => {
    const boardState = createInitialBoardState();
    // 8八: col = 1 (file 8), row = 7 (rank 8)
    const square88 = boardState.squares[7][1];
    expect(square88.coordinateLabel).toBe('8八');
    expect(square88.piece).not.toBeNull();
    expect(square88.piece?.player).toBe('sente');
    expect(square88.piece?.type).toBe('bishop');

    // 2八: col = 7 (file 2), row = 7 (rank 8)
    const square28 = boardState.squares[7][7];
    expect(square28.coordinateLabel).toBe('2八');
    expect(square28.piece).not.toBeNull();
    expect(square28.piece?.player).toBe('sente');
    expect(square28.piece?.type).toBe('rook');
  });

  it('6. 先手王が5九、後手玉が5一にある', () => {
    const boardState = createInitialBoardState();
    // 5九: col = 4 (file 5), row = 8 (rank 9)
    const square59 = boardState.squares[8][4];
    expect(square59.coordinateLabel).toBe('5九');
    expect(square59.piece?.player).toBe('sente');
    expect(square59.piece?.type).toBe('king');

    // 5一: col = 4 (file 5), row = 0 (rank 1)
    const square51 = boardState.squares[0][4];
    expect(square51.coordinateLabel).toBe('5一');
    expect(square51.piece?.player).toBe('gote');
    expect(square51.piece?.type).toBe('king');
  });

  it('7. 5九のARIA名称が「先手の王将」になる', () => {
    const boardState = createInitialBoardState();
    const square59 = boardState.squares[8][4];
    const ariaLabel = getSquareAriaLabel(square59);
    expect(ariaLabel).toBe('5筋 9段、先手の王将');
  });

  it('8. 5一のARIA名称が「後手の玉将」になる', () => {
    const boardState = createInitialBoardState();
    const square51 = boardState.squares[0][4];
    const ariaLabel = getSquareAriaLabel(square51);
    expect(ariaLabel).toBe('5筋 1段、後手の玉将');
  });

  it('9. 空マスのARIA名称が正しい', () => {
    const boardState = createInitialBoardState();
    // 4五: col = 5 (file 4), row = 4 (rank 5)
    const square45 = boardState.squares[4][5];
    expect(square45.piece).toBeNull();
    const ariaLabel = getSquareAriaLabel(square45);
    expect(ariaLabel).toBe('4筋 5段、空のマス');
  });

  it('10. 各成駒が通常駒とは異なる正しい文字になる', () => {
    // 王将・金将は成駒不可
    expect(canPromote('king')).toBe(false);
    expect(canPromote('gold')).toBe(false);
    expect(getPieceDisplayInfo('king', 'sente', true).fullName).toBe('王将');
    expect(getPieceDisplayInfo('king', 'gote', true).fullName).toBe('玉将');
    expect(getPieceDisplayInfo('gold', 'sente', true).fullName).toBe('金将');

    // 飛車 -> 竜王
    const rookPromoted = getPieceDisplayInfo('rook', 'sente', true);
    expect(rookPromoted.fullName).toBe('竜王');
    expect(rookPromoted.topChar).toBe('竜');
    expect(rookPromoted.bottomChar).toBe('王');
    expect(rookPromoted.ariaName).toBe('先手の竜王');
    expect(rookPromoted.isPromoted).toBe(true);
    expect(rookPromoted.isPromotedColor).toBe(true);

    // 角行 -> 竜馬
    const bishopPromoted = getPieceDisplayInfo('bishop', 'sente', true);
    expect(bishopPromoted.fullName).toBe('竜馬');
    expect(bishopPromoted.topChar).toBe('竜');
    expect(bishopPromoted.bottomChar).toBe('馬');
    expect(bishopPromoted.ariaName).toBe('先手の竜馬');

    // 銀将 -> 成銀
    const silverPromoted = getPieceDisplayInfo('silver', 'sente', true);
    expect(silverPromoted.fullName).toBe('成銀');
    expect(silverPromoted.topChar).toBe('成');
    expect(silverPromoted.bottomChar).toBe('銀');
    expect(silverPromoted.ariaName).toBe('先手の成銀');

    // 桂馬 -> 成桂
    const knightPromoted = getPieceDisplayInfo('knight', 'sente', true);
    expect(knightPromoted.fullName).toBe('成桂');
    expect(knightPromoted.topChar).toBe('成');
    expect(knightPromoted.bottomChar).toBe('桂');
    expect(knightPromoted.ariaName).toBe('先手の成桂');

    // 香車 -> 成香
    const lancePromoted = getPieceDisplayInfo('lance', 'sente', true);
    expect(lancePromoted.fullName).toBe('成香');
    expect(lancePromoted.topChar).toBe('成');
    expect(lancePromoted.bottomChar).toBe('香');
    expect(lancePromoted.ariaName).toBe('先手の成香');

    // 歩兵 -> と金
    const pawnPromoted = getPieceDisplayInfo('pawn', 'sente', true);
    expect(pawnPromoted.fullName).toBe('と金');
    expect(pawnPromoted.topChar).toBe('と');
    expect(pawnPromoted.bottomChar).toBe('金');
    expect(pawnPromoted.ariaName).toBe('先手のと金');
  });

  it('11. 盤上の星が4個だけで、3/9・6/9の対称位置にある', () => {
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
    // (row 2, col 2), (row 2, col 5), (row 5, col 2), (row 5, col 5)
    expect(starCoordinates).toEqual([
      { row: 2, col: 2, coordinate: '7三' },
      { row: 2, col: 5, coordinate: '4三' },
      { row: 5, col: 2, coordinate: '7六' },
      { row: 5, col: 5, coordinate: '4六' },
    ]);
  });

  it('12. 表示専用盤面で81個のTab停止位置が作られない', () => {
    const boardState = createInitialBoardState();
    const { container } = render(<ShogiBoard squares={boardState.squares} />);

    // onSquareClick が渡されていない表示専用盤面では、tabindex="0" を持つ要素が存在しない
    const focusableSquares = container.querySelectorAll('[tabindex="0"]');
    expect(focusableSquares.length).toBe(0);

    // role="grid", role="row", role="gridcell" が正しく構成されている
    const grid = container.querySelector('[role="grid"]');
    expect(grid).toBeInTheDocument();

    const rows = container.querySelectorAll('[role="row"]');
    expect(rows.length).toBe(9);

    const cells = container.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(81);
  });
});
