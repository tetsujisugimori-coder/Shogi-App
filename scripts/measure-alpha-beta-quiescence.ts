// Reference timings only; never a CI threshold.
// Run: npx tsx scripts/measure-alpha-beta-quiescence.ts
// Each position runs in a fresh process so JIT history cannot cross cases.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import {
  analyzeAlphaBetaSearch,
  cloneBoardSquares,
  DEFAULT_MATERIAL_VALUE_TABLE,
  type AlphaBetaSearchOptions,
  type SearchEvaluationConfig,
} from '../src/domain/shogi';
import { createInitialBoardState, type BoardState, type Piece, type PieceType, type Player } from '../src/types/shogi';

type Placement = readonly [row: number, col: number, type: PieceType, player: Player];

function piece(id: string, type: PieceType, player: Player): Piece {
  return { id, type, player };
}

function position(placements: readonly Placement[], turn: Player = 'sente', overrides: Partial<BoardState> = {}): BoardState {
  const initial = createInitialBoardState();
  const squares = cloneBoardSquares(initial.squares);
  for (const row of squares) for (const square of row) square.piece = null;
  squares[8][8].piece = piece('sente-king', 'king', 'sente');
  squares[0][8].piece = piece('gote-king', 'king', 'gote');
  for (const [row, col, type, player] of placements) squares[row][col].piece = piece(`${player}-${type}-${row}-${col}`, type, player);
  return { ...initial, squares, senteHand: [], goteHand: [], turn, ...overrides };
}

const materialOnly: SearchEvaluationConfig = {
  materialValueTable: DEFAULT_MATERIAL_VALUE_TABLE,
  coefficients: { material: 1, pieceSquare: 0, kingSafety: 0, undefendedPieceSafety: 0 },
};

const positions = {
  initial: createInitialBoardState(),
  quiet: position([]),
  recapture: position([
    [5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote'], [3, 4, 'pawn', 'gote'],
  ]),
  winningCapture: position([[5, 4, 'rook', 'sente'], [4, 4, 'pawn', 'gote']]),
  checkEvasion: position([[8, 4, 'king', 'sente'], [4, 4, 'rook', 'gote']], 'sente', {
    senteHand: [piece('sente-hand-gold', 'gold', 'sente')],
  }),
} as const;

const conditions: readonly { name: string; options: AlphaBetaSearchOptions | undefined }[] = [
  { name: 'disabled', options: { moveOrdering: 'standard' } },
  { name: 'tactical-depth-1', options: { moveOrdering: 'standard', quiescence: { maxTacticalDepth: 1 } } },
  { name: 'tactical-depth-2', options: { moveOrdering: 'standard', quiescence: { maxTacticalDepth: 2 } } },
];

const median = (values: readonly number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const comparable = (result: ReturnType<typeof analyzeAlphaBetaSearch>) => ({ ...result, elapsedMilliseconds: 0 });

function measureCase(name: keyof typeof positions) {
  const state = structuredClone(positions[name]);
  const before = structuredClone(state);
  const report = conditions.map(({ name: condition, options }) => {
    const run = () => analyzeAlphaBetaSearch(structuredClone(state), 3, materialOnly, undefined, options);
    for (let index = 0; index < 3; index += 1) run();
    const runs = Array.from({ length: 7 }, run);
    const reference = comparable(runs[0]);
    for (const result of runs) assert.deepEqual(comparable(result), reference);
    return {
      condition,
      medianMilliseconds: median(runs.map((result) => result.elapsedMilliseconds)),
      minimumMilliseconds: Math.min(...runs.map((result) => result.elapsedMilliseconds)),
      maximumMilliseconds: Math.max(...runs.map((result) => result.elapsedMilliseconds)),
      selectedAction: reference.selectedAction,
      selectedEvaluation: reference.selectedEvaluation,
      principalVariation: reference.principalVariation,
      evaluationBreakdown: reference.evaluationBreakdown,
      normalSearch: {
        visitedPositionCount: reference.visitedPositionCount,
        cutoffCount: reference.cutoffCount,
        skippedActionCount: reference.skippedActionCount,
      },
      quiescenceSearch: {
        leafCount: reference.quiescenceLeafCount,
        visitedPositionCount: reference.quiescenceVisitedPositionCount,
        cutoffCount: reference.quiescenceCutoffCount,
        skippedActionCount: reference.quiescenceSkippedActionCount,
      },
    };
  });
  assert.deepEqual(state, before);
  return { name, depth: 3, warmups: 3, samples: 7, report };
}

const caseArgument = process.argv.find((argument) => argument.startsWith('--case='));
if (caseArgument) {
  const name = caseArgument.slice('--case='.length) as keyof typeof positions;
  assert(name in positions, `Unknown position: ${name}`);
  console.log(JSON.stringify(measureCase(name), null, 2));
} else {
  const cases = (Object.keys(positions) as Array<keyof typeof positions>).map((name) =>
    JSON.parse(execFileSync(process.execPath, [...process.execArgv, import.meta.filename, `--case=${name}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    }))
  );
  console.log(JSON.stringify({
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    cases,
  }, null, 2));
}
