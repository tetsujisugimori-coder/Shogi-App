/**
 * Shogi Domain Types & Constants
 * Designed for future extensibility: AI evaluation, move history, spectator view, board animations.
 */

export type Player = 'sente' | 'gote';

export type PieceType =
  | 'king'
  | 'rook'
  | 'bishop'
  | 'gold'
  | 'silver'
  | 'knight'
  | 'lance'
  | 'pawn';

export interface Piece {
  id: string;
  type: PieceType;
  player: Player;
  isPromoted?: boolean;
  kanji: string; // e.g. "玉将" or "王将"
  kanjiTop?: string; // First character (e.g. "玉", "金", "歩")
  kanjiBottom?: string; // Second character (e.g. "将", "馬", "兵")
  promotedKanji?: string;
}

export interface BoardSquare {
  row: number; // 0 to 8 (top to bottom: 0 = Rank 1, 8 = Rank 9)
  col: number; // 0 to 8 (left to right: 0 = File 9, 8 = File 1)
  file: number; // 9 to 1 (筋: right to left from sente's view; col 0 is 9, col 8 is 1)
  rank: number; // 1 to 9 (段: top to bottom; row 0 is 1, row 8 is 9)
  rankKanji: string; // '一' | '二' | ... | '九'
  coordinateLabel: string; // e.g. '7七', '5一'
  piece: Piece | null;
  isStarSquare?: boolean; // True for intersection star markers (3-3, 3-7, 7-3, 7-7)
}

export type BoardStatus = 'preparation' | 'active' | 'check' | 'blunder' | 'evaluating' | 'ended';

export type TableViewMode = 'research' | 'spectator' | 'analysis';

export interface BoardState {
  squares: BoardSquare[][]; // 9x9 grid
  senteHand: Piece[];
  goteHand: Piece[];
  turn: Player;
  moveNumber: number;
  status: BoardStatus;
  viewMode: TableViewMode;
}

export const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
export const FILE_NUMBERS = [9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

/**
 * Japanese display names for piece types
 */
export const PIECE_DISPLAY_NAMES: Record<PieceType, { normal: { sente: string; gote: string }; promoted?: string }> = {
  king: {
    normal: { sente: '王', gote: '玉' },
  },
  rook: {
    normal: { sente: '飛', gote: '飛' },
    promoted: '竜',
  },
  bishop: {
    normal: { sente: '角', gote: '角' },
    promoted: '馬',
  },
  gold: {
    normal: { sente: '金', gote: '金' },
  },
  silver: {
    normal: { sente: '銀', gote: '銀' },
    promoted: '成銀',
  },
  knight: {
    normal: { sente: '桂', gote: '桂' },
    promoted: '成桂',
  },
  lance: {
    normal: { sente: '香', gote: '香' },
    promoted: '成香',
  },
  pawn: {
    normal: { sente: '歩', gote: '歩' },
    promoted: 'と',
  },
};

/**
 * Standard Hirate (平手) initial board setup.
 *
 * Sente (先手 - Bottom):
 *  - Rank 7 (row 6): Pawns (歩) on all 9 files
 *  - Rank 8 (row 7): 88 Bishop (角), 28 Rook (飛)
 *  - Rank 9 (row 8): 99 Lance(香), 89 Knight(桂), 79 Silver(銀), 69 Gold(金), 59 King(王), 49 Gold(金), 39 Silver(銀), 29 Knight(桂), 19 Lance(香)
 *
 * Gote (後手 - Top):
 *  - Rank 1 (row 0): 91 Lance(香), 81 Knight(桂), 71 Silver(銀), 61 Gold(金), 51 King(玉), 41 Gold(金), 31 Silver(銀), 21 Knight(桂), 11 Lance(香)
 *  - Rank 2 (row 1): 82 Rook(飛), 22 Bishop(角)
 *  - Rank 3 (row 2): Pawns (歩) on all 9 files
 */
export function createInitialBoardState(): BoardState {
  const squares: BoardSquare[][] = [];

  for (let row = 0; row < 9; row++) {
    const rowSquares: BoardSquare[] = [];
    const rank = row + 1;
    const rankKanji = RANK_KANJI[row];

    for (let col = 0; col < 9; col++) {
      const file = 9 - col;
      const coordinateLabel = `${file}${rankKanji}`;

      // Star intersections at (file 7, rank 3), (file 3, rank 3), (file 7, rank 7), (file 3, rank 7)
      // in 0-indexed: (row 2, col 2) = 73, (row 2, col 6) = 33, (row 6, col 2) = 77, (row 6, col 6) = 37
      const isStarSquare =
        (row === 2 || row === 6) && (col === 2 || col === 6);

      let piece: Piece | null = null;

      // Rank 1 (row 0): Gote base line
      if (row === 0) {
        if (file === 9 || file === 1) {
          piece = { id: `gote-lance-${file}`, type: 'lance', player: 'gote', kanji: '香車', kanjiTop: '香', kanjiBottom: '車' };
        } else if (file === 8 || file === 2) {
          piece = { id: `gote-knight-${file}`, type: 'knight', player: 'gote', kanji: '桂馬', kanjiTop: '桂', kanjiBottom: '馬' };
        } else if (file === 7 || file === 3) {
          piece = { id: `gote-silver-${file}`, type: 'silver', player: 'gote', kanji: '銀将', kanjiTop: '銀', kanjiBottom: '将' };
        } else if (file === 6 || file === 4) {
          piece = { id: `gote-gold-${file}`, type: 'gold', player: 'gote', kanji: '金将', kanjiTop: '金', kanjiBottom: '将' };
        } else if (file === 5) {
          piece = { id: `gote-king-5`, type: 'king', player: 'gote', kanji: '玉将', kanjiTop: '玉', kanjiBottom: '将' };
        }
      }
      // Rank 2 (row 1): Gote special pieces
      else if (row === 1) {
        if (file === 8) {
          piece = { id: `gote-rook-8`, type: 'rook', player: 'gote', kanji: '飛車', kanjiTop: '飛', kanjiBottom: '車' };
        } else if (file === 2) {
          piece = { id: `gote-bishop-2`, type: 'bishop', player: 'gote', kanji: '角行', kanjiTop: '角', kanjiBottom: '行' };
        }
      }
      // Rank 3 (row 2): Gote pawns
      else if (row === 2) {
        piece = { id: `gote-pawn-${file}`, type: 'pawn', player: 'gote', kanji: '歩兵', kanjiTop: '歩', kanjiBottom: '兵' };
      }
      // Rank 7 (row 6): Sente pawns
      else if (row === 6) {
        piece = { id: `sente-pawn-${file}`, type: 'pawn', player: 'sente', kanji: '歩兵', kanjiTop: '歩', kanjiBottom: '兵' };
      }
      // Rank 8 (row 7): Sente special pieces
      else if (row === 7) {
        if (file === 8) {
          piece = { id: `sente-bishop-8`, type: 'bishop', player: 'sente', kanji: '角行', kanjiTop: '角', kanjiBottom: '行' };
        } else if (file === 2) {
          piece = { id: `sente-rook-2`, type: 'rook', player: 'sente', kanji: '飛車', kanjiTop: '飛', kanjiBottom: '車' };
        }
      }
      // Rank 9 (row 8): Sente base line
      else if (row === 8) {
        if (file === 9 || file === 1) {
          piece = { id: `sente-lance-${file}`, type: 'lance', player: 'sente', kanji: '香車', kanjiTop: '香', kanjiBottom: '車' };
        } else if (file === 8 || file === 2) {
          piece = { id: `sente-knight-${file}`, type: 'knight', player: 'sente', kanji: '桂馬', kanjiTop: '桂', kanjiBottom: '馬' };
        } else if (file === 7 || file === 3) {
          piece = { id: `sente-silver-${file}`, type: 'silver', player: 'sente', kanji: '銀将', kanjiTop: '銀', kanjiBottom: '将' };
        } else if (file === 6 || file === 4) {
          piece = { id: `sente-gold-${file}`, type: 'gold', player: 'sente', kanji: '金将', kanjiTop: '金', kanjiBottom: '将' };
        } else if (file === 5) {
          piece = { id: `sente-king-5`, type: 'king', player: 'sente', kanji: '王将', kanjiTop: '王', kanjiBottom: '将' };
        }
      }

      rowSquares.push({
        row,
        col,
        file,
        rank,
        rankKanji,
        coordinateLabel,
        piece,
        isStarSquare,
      });
    }

    squares.push(rowSquares);
  }

  return {
    squares,
    senteHand: [],
    goteHand: [],
    turn: 'sente',
    moveNumber: 1,
    status: 'preparation',
    viewMode: 'research',
  };
}

/**
 * Generates an accessible screen-reader description for a square and piece.
 */
export function getSquareAriaLabel(square: BoardSquare): string {
  const positionStr = `${square.file}筋 ${square.rank}段`;
  if (!square.piece) {
    return `${positionStr}、空のマス`;
  }

  const playerStr = square.piece.player === 'sente' ? '先手' : '後手';
  const pieceNameMap: Record<PieceType, string> = {
    king: square.piece.kanji === '王' ? '王将' : '玉将',
    rook: square.piece.isPromoted ? '竜王' : '飛車',
    bishop: square.piece.isPromoted ? '竜馬' : '角行',
    gold: '金将',
    silver: square.piece.isPromoted ? '成銀' : '銀将',
    knight: square.piece.isPromoted ? '成桂' : '桂馬',
    lance: square.piece.isPromoted ? '成香' : '香車',
    pawn: square.piece.isPromoted ? 'と金' : '歩兵',
  };

  const name = pieceNameMap[square.piece.type];
  return `${positionStr}、${playerStr}の${name}`;
}
