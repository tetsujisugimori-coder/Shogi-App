import { createInitialBoardState, type Player } from '../src/types/shogi';
import { executeMove, getLegalActions, hasLegalBoardMove, hasLegalDrop, isPlayerInCheck, isCheckmate, analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest } from '../src/workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';

for (const player of ['sente', 'gote'] as const) {
  const opponent: Player = player === 'sente' ? 'gote' : 'sente';
  const state = createInitialBoardState();
  const pieces = state.squares.flat().flatMap(s => s.piece ? [s.piece] : []);
  state.squares.forEach(row => row.forEach(s => { s.piece = null; }));
  const coord = (row: number, col: number) => player === 'sente' ? {row, col} : {row: 8-row, col: 8-col};
  const place = (type: string, owner: Player, row: number, col: number) => {
    const index = pieces.findIndex(p => p.type === type && p.player === owner);
    const [piece] = pieces.splice(index, 1);
    const c = coord(row, col); state.squares[c.row][c.col].piece = piece;
  };
  place('king', player, 8, 0); place('king', opponent, 0, 8);
  place('rook', opponent, 6, 1); place('gold', opponent, 5, 0);
  state.turn = opponent; state.status = 'active';
  state.senteHand = []; state.goteHand = [];
  const hand = pieces.map(p => ({...p, player: opponent}));
  if (opponent === 'sente') state.senteHand = hand; else state.goteHand = hand;
  const before = JSON.stringify(state);
  const execution = executeMove(state, coord(5,0), coord(6,0));
  if (execution.type !== 'applied') throw new Error(JSON.stringify(execution));
  const target = execution.state;
  const frozen = JSON.stringify(target);
  // Query independently of the ended-state action enumeration's early return.
  const query = {...target, status:'active' as const, result:null};
  const actions = getLegalActions(query);
  const timed = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(query, 2, 0);
  const fixed = analyzeAlphaBetaSearch(query, 2);
  const worker = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest({
    type:'run-time-limited-iterative-deepening-alpha-beta-search', requestId:player,
    state:query,maxDepth:2,timeLimitMilliseconds:0,
  });
  const piecesOnBoard = target.squares.flat().flatMap(s=>s.piece?[s.piece]:[]);
  const allPieces = [...piecesOnBoard,...target.senteHand,...target.goteHand];
  console.log(JSON.stringify({player, pieceCount:allPieces.length,uniqueIds:new Set(allPieces.map(p=>p.id)).size,kings:piecesOnBoard.filter(p=>p.type==='king').map(p=>p.player),check: isPlayerInCheck(target, player), checkmate: isCheckmate(target,player), board: hasLegalBoardMove(target,player), drop: hasLegalDrop(target,player), boardActions: actions.filter(a=>a.kind==='move').length, dropActions: actions.filter(a=>a.kind==='drop').length, status:target.status, result:target.result, fixed:{action:fixed.selectedAction, evaluation:fixed.selectedEvaluation, breakdown:fixed.evaluationBreakdown}, timed:{action:timed.selectedAction,timedOut:timed.timedOut,resultSource:timed.resultSource}, worker:worker.type==='time-limited-iterative-deepening-alpha-beta-search-succeeded'?{type:worker.type,action:worker.result.selectedAction,source:worker.result.resultSource,timedOut:worker.result.timedOut}:worker,unchanged: before===JSON.stringify(state) && frozen===JSON.stringify(target)},(_key,value)=>typeof value==='number'&&!Number.isFinite(value)?String(value):value));
}
