import type {
  BoardState,
  PieceType,
  Player,
  PositionRecord,
} from '../../types/shogi';

const PIECE_TYPE_ORDER: readonly PieceType[] = [
  'king',
  'rook',
  'bishop',
  'gold',
  'silver',
  'knight',
  'lance',
  'pawn',
];

type PositionState = Pick<BoardState, 'squares' | 'senteHand' | 'goteHand' | 'turn'>;

/**
 * Creates a deterministic identity for a shogi position.
 * Piece IDs and hand ordering are intentionally excluded.
 */
export function createPositionKey(state: PositionState): string {
  const board = state.squares.flatMap((row) =>
    row.map((square) => {
      const piece = square.piece;
      return piece
        ? [piece.player, piece.type, piece.isPromoted === true ? 1 : 0]
        : null;
    })
  );

  const countHand = (player: Player) => {
    const hand = player === 'sente' ? state.senteHand : state.goteHand;
    return PIECE_TYPE_ORDER.map(
      (pieceType) => hand.filter((piece) => piece.type === pieceType).length
    );
  };

  return JSON.stringify([
    'shogi-position-v1',
    state.turn,
    board,
    countHand('sente'),
    countHand('gote'),
  ]);
}

/**
 * Ensures externally supplied or rearranged positions start from one trustworthy baseline.
 * No unavailable play history is inferred when the current key does not match the tail.
 */
export function normalizePositionHistory(state: BoardState): BoardState {
  const currentKey = createPositionKey(state);
  const history = state.positionHistory;
  if (history && history.length > 0 && history.at(-1)?.key === currentKey) {
    return state;
  }

  return {
    ...state,
    positionHistory: [
      {
        key: currentKey,
        historyIndex: state.history.length,
        movedBy: null,
        gaveCheck: false,
      },
    ],
  };
}

/** Appends the post-move position without mutating the existing history. */
export function recordPositionAfterLegalMove(
  state: BoardState,
  movedBy: Player,
  gaveCheck: boolean
): BoardState {
  return {
    ...state,
    positionHistory: [
      ...(state.positionHistory ?? []),
      {
        key: createPositionKey(state),
        historyIndex: state.history.length,
        movedBy,
        gaveCheck,
      },
    ],
  };
}

export type RepetitionOutcome =
  | { kind: 'repetition' }
  | { kind: 'perpetual_check'; checkingPlayer: Player };

/**
 * Classifies the fourth occurrence of the current position.
 * The inspected move interval starts immediately after occurrence one and ends at occurrence four.
 */
export function classifyRepetition(
  records: readonly PositionRecord[],
  currentKey: string
): RepetitionOutcome | null {
  const occurrenceIndexes = records
    .map((record, index) => (record.key === currentKey ? index : -1))
    .filter((index) => index >= 0);

  if (occurrenceIndexes.length < 4) return null;

  const fourthOccurrenceIndexes = occurrenceIndexes.slice(-4);
  const interval = records.slice(
    fourthOccurrenceIndexes[0] + 1,
    fourthOccurrenceIndexes[3] + 1
  );
  const continuousCheckingPlayers = (['sente', 'gote'] as const).filter((player) => {
    const playerMoves = interval.filter((record) => record.movedBy === player);
    return playerMoves.length > 0 && playerMoves.every((record) => record.gaveCheck);
  });

  // Both players qualifying indicates inconsistent or synthetic data. Do not pick a loser implicitly.
  if (continuousCheckingPlayers.length !== 1) {
    return { kind: 'repetition' };
  }

  return {
    kind: 'perpetual_check',
    checkingPlayer: continuousCheckingPlayers[0],
  };
}
