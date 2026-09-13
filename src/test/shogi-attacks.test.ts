import { describe, expect, it } from 'vitest';
import { BoardSquare, Piece, Player, RANK_KANJI } from '../types/shogi';
import {
  countSquareAttackersBy,
  isKingInCheck,
  isSquareAttackedBy,
} from '../domain/shogi';

function createAttackBoard(
  pieces: Array<{ row: number; col: number; piece: Piece }>
): BoardSquare[][] {
  const squares = Array.from({ length: 9 }, (_, row) =>
    Array.from<unknown, BoardSquare>({ length: 9 }, (_, col) => ({
      row,
      col,
      file: 9 - col,
      rank: row + 1,
      rankKanji: RANK_KANJI[row],
      coordinateLabel: `${9 - col}${RANK_KANJI[row]}`,
      piece: null,
      hasBottomRightStarMarker: false,
    }))
  );

  for (const { row, col, piece } of pieces) {
    squares[row][col].piece = piece;
  }

  return squares;
}

function piece(id: string, type: Piece['type'], player: Player, isPromoted?: boolean): Piece {
  return { id, type, player, isPromoted };
}

describe('countSquareAttackersBy', () => {
  it('returns explicit counts for no attackers, one attacker, and multiple distinct attackers', () => {
    expect(countSquareAttackersBy(createAttackBoard([]), { row: 4, col: 4 }, 'sente')).toBe(0);

    const oneAttacker = createAttackBoard([
      { row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
    ]);
    expect(countSquareAttackersBy(oneAttacker, { row: 4, col: 4 }, 'sente')).toBe(1);

    const multipleAttackers = createAttackBoard([
      { row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
      { row: 2, col: 2, piece: piece('sente-bishop', 'bishop', 'sente') },
      { row: 4, col: 0, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 3, col: 4, piece: piece('sente-gold', 'gold', 'sente') },
      { row: 5, col: 5, piece: piece('sente-king', 'king', 'sente') },
    ]);
    expect(countSquareAttackersBy(multipleAttackers, { row: 4, col: 4 }, 'sente')).toBe(5);
  });

  it('stops rook, bishop, and lance rays after their first obstacle while counting that obstacle square', () => {
    const rook = createAttackBoard([
      { row: 4, col: 0, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 2, piece: piece('rook-blocker', 'gold', 'gote') },
    ]);
    expect(countSquareAttackersBy(rook, { row: 4, col: 2 }, 'sente')).toBe(1);
    expect(countSquareAttackersBy(rook, { row: 4, col: 4 }, 'sente')).toBe(0);

    const bishop = createAttackBoard([
      { row: 0, col: 0, piece: piece('sente-bishop', 'bishop', 'sente') },
      { row: 2, col: 2, piece: piece('bishop-blocker', 'silver', 'sente') },
    ]);
    expect(countSquareAttackersBy(bishop, { row: 2, col: 2 }, 'sente')).toBe(1);
    expect(countSquareAttackersBy(bishop, { row: 4, col: 4 }, 'sente')).toBe(0);

    const lance = createAttackBoard([
      { row: 6, col: 4, piece: piece('sente-lance', 'lance', 'sente') },
      { row: 4, col: 4, piece: piece('lance-blocker', 'pawn', 'gote') },
    ]);
    expect(countSquareAttackersBy(lance, { row: 4, col: 4 }, 'sente')).toBe(1);
    expect(countSquareAttackersBy(lance, { row: 2, col: 4 }, 'sente')).toBe(0);
  });

  it('uses the existing patterns for every promoted piece type', () => {
    const promotedCases: Array<{ type: Piece['type']; target: { row: number; col: number } }> = [
      { type: 'pawn', target: { row: 3, col: 4 } },
      { type: 'lance', target: { row: 3, col: 4 } },
      { type: 'knight', target: { row: 3, col: 4 } },
      { type: 'silver', target: { row: 3, col: 4 } },
      { type: 'rook', target: { row: 3, col: 3 } },
      { type: 'bishop', target: { row: 4, col: 5 } },
    ];

    for (const { type, target } of promotedCases) {
      const squares = createAttackBoard([
        { row: 4, col: 4, piece: piece(`promoted-${type}`, type, 'sente', true) },
      ]);
      expect(countSquareAttackersBy(squares, target, 'sente')).toBe(1);
    }
  });

  it('is 180-degree symmetric for sente and gote', () => {
    const sentePosition = createAttackBoard([
      { row: 4, col: 0, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 2, col: 2, piece: piece('sente-bishop', 'bishop', 'sente') },
      { row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
    ]);
    const gotePosition = createAttackBoard([
      { row: 4, col: 8, piece: piece('gote-rook', 'rook', 'gote') },
      { row: 6, col: 6, piece: piece('gote-bishop', 'bishop', 'gote') },
      { row: 3, col: 4, piece: piece('gote-pawn', 'pawn', 'gote') },
    ]);

    expect(countSquareAttackersBy(sentePosition, { row: 4, col: 4 }, 'sente')).toBe(3);
    expect(countSquareAttackersBy(gotePosition, { row: 4, col: 4 }, 'gote')).toBe(3);
  });

  it('counts raw attacks on friendly pieces, enemy pieces, and Kings', () => {
    const targetPieces: Piece[] = [
      piece('friendly-gold', 'gold', 'sente'),
      piece('enemy-gold', 'gold', 'gote'),
      piece('enemy-king', 'king', 'gote'),
    ];

    for (const targetPiece of targetPieces) {
      const squares = createAttackBoard([
        { row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
        { row: 4, col: 4, piece: targetPiece },
      ]);
      expect(countSquareAttackersBy(squares, { row: 4, col: 4 }, 'sente')).toBe(1);
    }
  });

  it('returns zero outside the board and shares its answer with the boolean API', () => {
    const attacked = createAttackBoard([
      { row: 5, col: 4, piece: piece('sente-pawn', 'pawn', 'sente') },
    ]);
    const blocked = createAttackBoard([
      { row: 4, col: 0, piece: piece('sente-rook', 'rook', 'sente') },
      { row: 4, col: 2, piece: piece('blocker', 'gold', 'gote') },
    ]);

    expect(countSquareAttackersBy(attacked, { row: -1, col: 4 }, 'sente')).toBe(0);
    expect(countSquareAttackersBy(attacked, { row: 9, col: 4 }, 'sente')).toBe(0);
    for (const [squares, target] of [
      [attacked, { row: 4, col: 4 }],
      [blocked, { row: 4, col: 4 }],
      [blocked, { row: 4, col: 2 }],
    ] as const) {
      expect(countSquareAttackersBy(squares, target, 'sente') > 0).toBe(
        isSquareAttackedBy(squares, target, 'sente')
      );
    }
  });

  it('counts a pinned piece as raw influence and leaves inputs unchanged across repeated calls', () => {
    const target = { row: 6, col: 4 };
    const squares = createAttackBoard([
      { row: 8, col: 4, piece: piece('sente-king', 'king', 'sente') },
      { row: 7, col: 4, piece: piece('pinned-sente-gold', 'gold', 'sente') },
      { row: 0, col: 4, piece: piece('gote-rook', 'rook', 'gote') },
    ]);
    const before = JSON.stringify(squares);

    expect(countSquareAttackersBy(squares, target, 'sente')).toBe(1);
    expect(countSquareAttackersBy(squares, target, 'sente')).toBe(1);
    expect(isKingInCheck(squares, 'sente')).toBe(false);
    expect(JSON.stringify(squares)).toBe(before);
    expect(target).toEqual({ row: 6, col: 4 });
  });
});
