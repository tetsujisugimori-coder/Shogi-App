import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  executeMove, executeDrop, executeLegalAction, getLegalActions, getLegalMoves,
  getLegalDropSquares, hasLegalBoardMove, hasLegalDrop, isPlayerInCheck, isCheckmate,
  analyzeAlphaBetaSearch, analyzeTwoPlyMinimaxSearch,
  analyzeIterativeDeepeningAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  selectRandomLegalAction, selectBestMaterialAction, evaluateSearchPosition,
  serializeShogiGameRecordV1, importShogiGameRecord, restoreBoardStateAtHistoryIndex, createKifText,
  analyzeEvaluationPresetComparison, runSelfPlayGame,
} from '../domain/shogi';
import { analyzeQuiescenceComparison } from '../domain/shogi/quiescenceComparison';
import { analyzeTimeLimitedQuiescenceComparison } from '../domain/shogi/timeLimitedQuiescenceComparison';
import { validateEvaluationPresetComparison } from '../application/evaluationPresetComparisonValidation';
import { validateQuiescenceComparison } from '../application/quiescenceComparisonValidation';
import { validateTimeLimitedQuiescenceComparison } from '../application/timeLimitedQuiescenceComparisonValidation';
import { createInitialBoardState as initial, type BoardState, type PieceType } from '../types/shogi';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import { noLegalActionsCase } from './no-legal-actions.cases';
import { createPositionKey, classifyRepetition } from '../domain/shogi/repetition';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';

function apply(state: BoardState, from: {row:number;col:number}, to: {row:number;col:number}) {
  const result = executeMove(state, from, to, {promotion: state.squares[from.row][from.col].piece?.type === 'rook' ? 'decline' : undefined});
  if (result.type !== 'applied') throw new Error('Fixture move rejected');
  return result.state;
}
function transfer(state: BoardState, type: PieceType) {
  const donor = state.turn === 'sente' ? state.senteHand : state.goteHand;
  const receiver = state.turn === 'sente' ? state.goteHand : state.senteHand;
  const index = donor.findIndex(p => p.type === type);
  const [piece] = donor.splice(index, 1);
  receiver.push({...piece, player: state.turn === 'sente' ? 'gote' : 'sente'});
}

describe('non-check no-legal-action adjudication', () => {
  it.each(['sente', 'gote'] as const)('%s: legal public move ends the game, without changing either input', player => {
    const {before, coord, opponent} = noLegalActionsCase(player);
    const original = structuredClone(before);
    const ended = apply(before, coord(5,0), coord(6,0));
    expect(before).toEqual(original);
    // Re-enable the query view so ended-state early return cannot hide legal moves.
    const query = {...ended, status: 'active' as const, result: null};
    const frozen = structuredClone(query);
    const pieces = query.squares.flat().flatMap(s => s.piece ? [s.piece] : []).concat(query.senteHand, query.goteHand);
    expect(pieces).toHaveLength(40);
    expect(new Set(pieces.map(p => p.id)).size).toBe(40);
    expect(pieces.filter(p => p.type === 'king').map(p=>p.player).sort()).toEqual(['gote','sente']);
    expect(query.squares).toHaveLength(9);
    for (const row of query.squares) expect(row).toHaveLength(9);
    expect(isPlayerInCheck(query, player)).toBe(false);
    expect(isCheckmate(query, player)).toBe(false);
    expect(hasLegalBoardMove(query, player)).toBe(false);
    expect(hasLegalDrop(query, player)).toBe(false);
    const moves = query.squares.flat().filter(s=>s.piece?.player===player)
      .flatMap(s=>getLegalMoves(query.squares, s, player));
    expect(moves).toEqual([]);
    expect((player==='sente'?query.senteHand:query.goteHand).flatMap(p=>getLegalDropSquares(query,p.id))).toEqual([]);
    expect(getLegalActions(query)).toEqual([]);
    expect(query).toEqual(frozen);
    expect(ended).toMatchObject({status:'ended',result:{winner:opponent,loser:player,endReason:'no_legal_actions'}});
    expect(evaluateSearchPosition(ended,player)).toBe(-Infinity);
    const terminal = structuredClone(ended);
    expect(executeMove(ended,coord(8,0),coord(7,0))).toMatchObject({type:'rejected',reason:'game_already_ended'});
    const handPiece = (opponent==='sente'?ended.senteHand:ended.goteHand)[0];
    expect(executeDrop(ended,handPiece.id,coord(4,4))).toMatchObject({type:'rejected',reason:'game_already_ended'});
    expect(executeLegalAction(ended,{kind:'move',player,from:coord(8,0),to:coord(7,0),pieceType:'king',promotion:'none'})).toMatchObject({type:'rejected',reason:'game_already_ended'});
    expect(ended).toEqual(terminal);
    for (const result of [analyzeAlphaBetaSearch(query,2), analyzeTwoPlyMinimaxSearch(query), analyzeIterativeDeepeningAlphaBetaSearch(query,2)]) {
      expect(result.selectedAction).toBeNull();
      expect(result.selectedEvaluation).toBe(-Infinity);
      expect(result.evaluationBreakdown).toMatchObject({terminal:'loss',total:-Infinity});
    }
    expect(selectRandomLegalAction(query)).toBeNull();
    expect(selectBestMaterialAction(query,player)).toBeNull();
    for (const milliseconds of [0,1000]) {
      const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(query,2,milliseconds);
      expect(result).toMatchObject({selectedAction:null, selectedEvaluation:-Infinity, resultSource:'no-legal-actions',timedOut:false,completedDepth:0,principalVariation:[],iterations:[]});
    }
    const worker = handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest({type:'run-time-limited-iterative-deepening-alpha-beta-search', requestId:'no-moves',state:query,maxDepth:2,timeLimitMilliseconds:0});
    expect(worker).toMatchObject({type:'time-limited-iterative-deepening-alpha-beta-search-succeeded',result:{selectedAction:null,resultSource:'no-legal-actions',timedOut:false,selectedEvaluation:-Infinity}});
    expect(query).toEqual(frozen);
    expect(restoreBoardStateAtHistoryIndex(ended,0)).toMatchObject({status:'active',result:null,turn:opponent,history:[]});
    expect(restoreBoardStateAtHistoryIndex(ended,1)).toEqual(ended);
    const json = serializeShogiGameRecordV1(ended,new Date(0));
    expect(JSON.parse(json).result.endReason).toBe('no_legal_actions');
    // Existing import supports hirate records only: a custom baseline stays rejected.
    expect(importShogiGameRecord(json)).toMatchObject({ok:false,code:'inconsistent_record'});
  });

  it('a legal hand drop keeps a board-immobile side active', () => {
    const {before,coord} = noLegalActionsCase(); transfer(before,'gold');
    const after = apply(before,coord(5,0),coord(6,0));
    expect(hasLegalBoardMove(after,'sente')).toBe(false);
    expect(hasLegalDrop(after,'sente')).toBe(true);
    expect(getLegalActions(after).every(a=>a.kind==='drop')).toBe(true);
    expect(after).toMatchObject({status:'active',result:null});
  });

  it('hand pieces with no legal drops do not prevent ordinary checkmate; a blocking drop does', () => {
    const {before,coord} = noLegalActionsCase(); transfer(before,'knight');
    const query = apply(before,coord(5,0),coord(6,0));
    // Put the rook next to the king and protect it with the second gold.
    const state = {...query,status:'active' as const,result:null};
    const goldIndex=state.goteHand.findIndex(p=>p.type==='gold');
    state.squares[7][2].piece=state.goteHand.splice(goldIndex,1)[0];
    const mate = apply({...state,turn:'gote'},coord(6,1),coord(8,1));
    expect(mate.result).toEqual({winner:'gote',loser:'sente',endReason:'checkmate'});
    const mated = {...mate,status:'check' as const,result:null};
    expect(isPlayerInCheck(mated,'sente')).toBe(true);
    expect(hasLegalBoardMove(mated,'sente')).toBe(false);
    expect(hasLegalDrop(mated,'sente')).toBe(false);
    expect(getLegalActions(mated)).toEqual([]);
    expect(isCheckmate(mated,'sente')).toBe(true);
    // Move the checker further away: knight can now interpose on 9八.
    mated.squares[6][2].piece=mated.squares[6][0].piece;
    mated.squares[6][0].piece=mated.squares[8][1].piece; mated.squares[8][1].piece=null;
    expect(isPlayerInCheck(mated,'sente')).toBe(true);
    expect(hasLegalDrop(mated,'sente')).toBe(true);
    expect(isCheckmate(mated,'sente')).toBe(false);
    const escape = getLegalActions(mated).find(a=>a.kind==='drop')!;
    const escaped = executeLegalAction(mated,escape);
    expect(escaped.type).toBe('applied');
    if (escaped.type==='applied') expect(isPlayerInCheck(escaped.state,'sente')).toBe(false);
  });

  it('zero actions is distinct from timeout and worker failure even with a zero budget', () => {
    const {before,coord}=noLegalActionsCase();
    const ended=apply(before,coord(5,0),coord(6,0));
    const query={...ended,status:'active' as const,result:null};
    const noMoves=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(query,2,0);
    expect(noMoves).toMatchObject({selectedAction:null,resultSource:'no-legal-actions',timedOut:false,selectedEvaluation:-Infinity});
    const timeout=analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(initial(),2,0);
    expect(timeout).toMatchObject({resultSource:'fallback',timedOut:true});
    expect(timeout.selectedAction).not.toBeNull();
    const failure=handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest({type:'run-time-limited-iterative-deepening-alpha-beta-search',requestId:'failure',state:query,maxDepth:2,timeLimitMilliseconds:0},()=>{throw new Error('search failed');});
    expect(failure.type).toBe('time-limited-iterative-deepening-alpha-beta-search-failed');
  });

  it('self-play adjudicates a confirmed empty root without inventing a ply', () => {
    const {before,coord}=noLegalActionsCase();
    const query={...apply(before,coord(5,0),coord(6,0)),status:'active' as const,result:null};
    const participant={settings:null,search:(state:BoardState)=>analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,2,0)};
    const result=runSelfPlayGame({initialState:query,sente:participant,gote:participant,maxPlies:1});
    expect(result).toMatchObject({status:'ended',gameResult:{winner:'gote',loser:'sente',endReason:'no_legal_actions'},plies:[]});
  });

  it.each(['repetition','perpetual_check'] as const)('no legal actions takes precedence over %s and the 500-move rule', kind => {
    const {before,coord}=noLegalActionsCase();
    const target=apply(before,coord(5,0),coord(6,0));
    const key=createPositionKey(target);
    before.moveNumber=500;
    before.positionHistory=[
      ...[0,0,0].map(historyIndex=>({key,historyIndex,movedBy:null,gaveCheck:false})),
      {key:createPositionKey(before),historyIndex:0,movedBy:null,gaveCheck:false},
    ];
    if (kind==='perpetual_check') {
      before.positionHistory=[
        {key,historyIndex:0,movedBy:'gote',gaveCheck:false},
        {key:'synthetic-1',historyIndex:0,movedBy:'sente',gaveCheck:true},
        {key,historyIndex:0,movedBy:'gote',gaveCheck:false},
        {key:'synthetic-2',historyIndex:0,movedBy:'sente',gaveCheck:true},
        {key,historyIndex:0,movedBy:'gote',gaveCheck:false},
        {key:createPositionKey(before),historyIndex:0,movedBy:'sente',gaveCheck:true},
      ];
    }
    const after=apply(before,coord(5,0),coord(6,0));
    expect(after.moveNumber).toBe(501);
    expect(after.positionHistory?.filter(p=>p.key===key)).toHaveLength(4);
    expect(classifyRepetition(after.positionHistory!,key)?.kind).toBe(kind);
    expect(after.result?.endReason).toBe('no_legal_actions');
  });

  it('normal records still load, while bogus no-legal-actions results are rejected', () => {
    const json = serializeShogiGameRecordV1(initial(),new Date(0));
    expect(importShogiGameRecord(json)).toMatchObject({ok:true});
    const bogus=JSON.parse(json); bogus.result={winner:'gote',loser:'sente',endReason:'no_legal_actions'}; bogus.latestState.status='ended';
    expect(importShogiGameRecord(JSON.stringify(bogus))).toMatchObject({ok:false,code:'inconsistent_record'});
    expect(()=>createKifText({...initial(),status:'ended',result:{winner:'gote',loser:'sente',endReason:'no_legal_actions'}})).toThrow(/JSON/);
  });

  it('comparison receivers accept a real no-action terminal and reject fabricated timeout metadata', () => {
    const {before,coord}=noLegalActionsCase();
    const query={...apply(before,coord(5,0),coord(6,0)),status:'active' as const,result:null};
    const presets=analyzeEvaluationPresetComparison(query,3,()=>0);
    expect(presets.every(r=>r.evaluationBreakdown?.terminal==='loss' && r.selectedEvaluation===-Infinity)).toBe(true);
    expect(()=>validateEvaluationPresetComparison(query,3,presets)).not.toThrow();
    const fixed=analyzeQuiescenceComparison(query,3,()=>0);
    expect(()=>validateQuiescenceComparison(query,3,fixed)).not.toThrow();
    const timed=analyzeTimeLimitedQuiescenceComparison(query,4,1000,()=>0);
    expect(timed.every(r=>r.resultSource==='no-legal-actions' && r.timedOut===false)).toBe(true);
    expect(()=>validateTimeLimitedQuiescenceComparison(query,4,1000,timed)).not.toThrow();
    const forged=timed.map(r=>({...r,timedOut:true}));
    expect(()=>validateTimeLimitedQuiescenceComparison(query,4,1000,forged)).toThrow();
  });

  it('Worker no-action response ends a custom active position instead of displaying an error', async () => {
    const {before,coord}=noLegalActionsCase();
    const query={...apply(before,coord(5,0),coord(6,0)),status:'active' as const,result:null};
    render(<ShogiResearchScreen initialState={query} workerSearchRunner={async (state,maxDepth,timeLimitMilliseconds,_signal,evaluationPresetId,quiescenceMaxTacticalDepth)=>({
      ...analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,maxDepth,timeLimitMilliseconds),
      evaluationPresetId:evaluationPresetId ?? 'standard',quiescenceMaxTacticalDepth:quiescenceMaxTacticalDepth ?? null,
    })}/>);
    const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:'時間制限AIに指させる'}));
    expect(await screen.findByRole('status')).toHaveTextContent('終局 / 後手勝ち（先手の合法手なし）');
    expect(screen.queryByText('AIの指し手を受け取れませんでした。')).not.toBeInTheDocument();
  });

  it('public UI move displays the new ending and disables the board', async () => {
    const {before}=noLegalActionsCase(); render(<ShogiResearchScreen initialState={before}/>);
    const user=userEvent.setup();
    await user.click(document.querySelector('[data-coordinate="9六"]') as HTMLElement);
    await user.click(document.querySelector('[data-coordinate="9七"]') as HTMLElement);
    expect(screen.getByRole('status')).toHaveTextContent('終局 / 後手勝ち（先手の合法手なし）');
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
  });
});
