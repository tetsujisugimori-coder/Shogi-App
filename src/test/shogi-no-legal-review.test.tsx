import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import * as attacks from '../domain/shogi/attacks';
import userEvent from '@testing-library/user-event';
import * as shogi from '../domain/shogi';
import { createInitialBoardState, type BoardState, type GameResult, type Player } from '../types/shogi';
import { noLegalActionsCase } from './no-legal-actions.cases';
import { ShogiResearchScreen } from '../components/shogi/ShogiResearchScreen';
import { handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest } from '../workers/timeLimitedIterativeDeepeningAlphaBetaWorkerHandler';
import { validateTimeLimitedQuiescenceComparison } from '../application/timeLimitedQuiescenceComparisonValidation';
import { analyzeTimeLimitedQuiescenceComparison } from '../domain/shogi/timeLimitedQuiescenceComparison';
import { validateOrderingResult } from '../../scripts/benchmarks/quiescenceOrderingSuite';
import { AiSearchResultPanel } from '../components/shogi/AiSearchResultPanel';

afterEach(()=>vi.restoreAllMocks());
function emptyRoot(player:Player):BoardState {
  const {before,coord}=noLegalActionsCase(player);
  const result=shogi.executeMove(before,coord(5,0),coord(6,0));
  if(result.type!=='applied') throw new Error('fixture');
  return {...result.state,status:'active',result:null};
}

describe('PR182 review: root classification',()=>{
  it.each(['sente','gote'] as const)('%s: preserves each ended reason at 0/100/1000ms, even with an expired fake clock',player=>{
    const other=player==='sente'?'gote':'sente';
    const results:GameResult[]=[
      {winner:other,loser:player,endReason:'checkmate'},
      {winner:other,loser:player,endReason:'no_legal_actions'},
      {winner:null,loser:null,endReason:'repetition'},
      {winner:other,loser:player,endReason:'foul_loss',foulReason:'perpetual_check_repetition'},
      {winner:other,loser:player,endReason:'resignation'},
      {winner:null,loser:null,endReason:'five_hundred_move_jishogi'},
      {winner:player,loser:other,endReason:'entering_king_win'},
    ];
    for(const result of results) for(const budget of [0,100,1000]) {
      const state:BoardState={...createInitialBoardState(),turn:player,status:'ended',result};
      const frozen=structuredClone(state);
      let now=0;
      const found=shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,4,budget,undefined,()=>now+=2000);
      expect(found).toMatchObject({resultSource:'ended-position',terminalResult:result,selectedAction:null,selectedEvaluation:result.winner===null?0:result.winner===player?Infinity:-Infinity,depth:0,completedDepth:0,timedOut:false,iterations:[],principalVariation:[],rootLegalActionCount:0,totalVisitedPositionCount:0});
      expect(found.evaluationBreakdown?.total).toBe(found.selectedEvaluation);
      expect(found.terminalResult).not.toBe(state.result);
      expect(state).toEqual(frozen);
      const worker=handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest({type:'run-time-limited-iterative-deepening-alpha-beta-search',requestId:'ended',state,maxDepth:4,timeLimitMilliseconds:budget});
      expect(worker).toMatchObject({type:'time-limited-iterative-deepening-alpha-beta-search-succeeded',result:{resultSource:'ended-position',terminalResult:result,timedOut:false}});
      expect(structuredClone(worker)).toEqual(worker);
    }
  });

  it.each(['sente','gote'] as const)('%s: true empty active root remains a loss; artificial kingless root remains non-terminal',player=>{
    const state=emptyRoot(player);
    for(const budget of [0,100,1000]) {
      const found=shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,4,budget);
      expect(found).toMatchObject({resultSource:'no-legal-actions',selectedAction:null,selectedEvaluation:-Infinity,completedDepth:0,timedOut:false,iterations:[]});
      expect(found.terminalResult).toBeUndefined();
    }
    const artificial=createInitialBoardState();
    artificial.squares.forEach(row=>row.forEach(s=>{s.piece=null;}));
    for(const budget of [0,100,1000]) {
      const found=shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(artificial,4,budget);
      expect(found.evaluationBreakdown?.terminal).toBeNull();
      expect(found.terminalResult).toBeUndefined();
      expect(found.selectedAction).toBeNull();
      expect(found.timedOut).toBe(false);
    }
    expect(shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(createInitialBoardState(),4,0)).toMatchObject({resultSource:'fallback',timedOut:true,completedDepth:0});
    expect(shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(createInitialBoardState(),1,1000,undefined,()=>0)).toMatchObject({resultSource:'completed-iteration',timedOut:false,completedDepth:1});
  });

  it('comparison accepts the ended root and rejects a changed terminal reason',()=>{
    const state:BoardState={...createInitialBoardState(),status:'ended',result:{winner:null,loser:null,endReason:'repetition'}};
    const results=analyzeTimeLimitedQuiescenceComparison(state,4,1000,()=>0);
    expect(results.every(r=>r.resultSource==='ended-position')).toBe(true);
    expect(()=>validateTimeLimitedQuiescenceComparison(state,4,1000,results)).not.toThrow();
    const fake=results.map(r=>({...r,terminalResult:{winner:null,loser:null,endReason:'five_hundred_move_jishogi' as const}}));
    expect(()=>validateTimeLimitedQuiescenceComparison(state,4,1000,fake)).toThrow();
    const mislabeled=results.map(r=>({...r,resultSource:'completed-iteration' as const}));
    expect(()=>validateTimeLimitedQuiescenceComparison(state,4,1000,mislabeled)).toThrow();
    expect(()=>validateOrderingResult(state,results[0],'timed',1)).not.toThrow();
    const empty=emptyRoot('sente');
    const none=shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(empty,4,0);
    expect(()=>validateOrderingResult(empty,none,'timed',1)).not.toThrow();
  });
  it('ended-result panel displays the preserved reason',()=>{
    const state:BoardState={...createInitialBoardState(),status:'ended',result:{winner:null,loser:null,endReason:'repetition'}};
    const found=shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,4,0);
    render(<AiSearchResultPanel search={{kind:'time-limited-worker',perspective:'sente',result:{...found,evaluationPresetId:'standard',quiescenceMaxTacticalDepth:null},selectedNotation:'手なし',principalVariationNotations:[]}}/>);
    expect(screen.getByText('終局済み')).toBeInTheDocument();
    expect(screen.getByText(/千日手/)).toBeInTheDocument();
  });
});

describe('PR182 review: AI no-action DOM boundary',()=>{
  it.each([['sente','two-ply'],['gote','two-ply'],['sente','worker'],['gote','worker']] as const)('%s %s ends only an independently confirmed empty position',async(player,mode)=>{
    const state=emptyRoot(player);
    const frozen=structuredClone(state);
    render(<ShogiResearchScreen initialState={state} workerSearchRunner={async(s,d,t,_signal,preset,quiescence)=>({...shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,d,t),evaluationPresetId:preset??'standard',quiescenceMaxTacticalDepth:quiescence??null})}/>);
    await userEvent.setup().click(screen.getByRole('button',{name:mode==='two-ply'?'2手読みAIに指させる':'時間制限AIに指させる'}));
    expect(screen.getByRole('status')).toHaveTextContent(player==='sente'?'終局 / 後手勝ち（先手の合法手なし）':'終局 / 先手勝ち（後手の合法手なし）');
    expect(document.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(state).toEqual(frozen);
    expect(within(screen.getByRole('log',{name:'着手履歴'})).getAllByRole('listitem')).toHaveLength(frozen.history.length);
    const download=vi.spyOn(shogi,'downloadShogiGameRecord').mockImplementation(()=>{});
    await userEvent.setup().click(screen.getByRole('button',{name:'対局記録を保存'}));
    expect(download).toHaveBeenCalledOnce();
    const json=JSON.parse(download.mock.calls[0][0]);
    const record=json.mainline ?? json;
    expect(record.history).toHaveLength(frozen.history.length);
  });
  it('a null minimax result with available actions leaves the game active',async()=>{
    vi.spyOn(shogi,'analyzeTwoPlyMinimaxSearch').mockReturnValue({selectedAction:null,selectedEvaluation:null,evaluationBreakdown:null,rootLegalActionCount:30,visitedPositionCount:0,depth:2,elapsedMilliseconds:0,topCandidates:[]});
    render(<ShogiResearchScreen/>);
    await userEvent.setup().click(screen.getByRole('button',{name:'2手読みAIに指させる'}));
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(document.getElementById('shogi-match-table')).not.toHaveAttribute('data-board-status','ended');
  });
  it('a forged no-action Worker result with available actions remains an error',async()=>{
    render(<ShogiResearchScreen workerSearchRunner={async(_state,d,t,_signal,preset,q)=>({...shogi.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(emptyRoot('sente'),d,t),evaluationPresetId:preset??'standard',quiescenceMaxTacticalDepth:q??null})}/>);
    await userEvent.setup().click(screen.getByRole('button',{name:'時間制限AIに指させる'}));
    expect(screen.getByRole('status')).toHaveTextContent('対局中 / 先手番');
    expect(await screen.findByText(/AIの指し手を受け取れませんでした。/)).toBeInTheDocument();
  });
});

describe('PR182 review: exact bounded response queries',()=>{
  it('board existence validates one safe king destination instead of all destinations',()=>{
    const state=createInitialBoardState();
    state.squares.forEach(row=>row.forEach(s=>{s.piece=null;}));
    state.squares[8][8].piece={id:'s',type:'king',player:'sente'};
    state.squares[0][8].piece={id:'g',type:'king',player:'gote'};
    expect(shogi.getLegalMoves(state.squares,{row:8,col:8},'sente')).toHaveLength(3);
    const checks=vi.spyOn(attacks,'isKingInCheck');
    expect(shogi.hasLegalBoardMove(state,'sente')).toBe(true);
    expect(checks).toHaveBeenCalledTimes(1);
  });
  it('drop existence stops at one legal square and does not cache across queries',()=>{
    const state=emptyRoot('sente');
    const index=state.goteHand.findIndex(p=>p.type==='gold');
    state.senteHand=[{...state.goteHand.splice(index,1)[0],player:'sente'}];
    const checks=vi.spyOn(attacks,'isKingInCheck');
    expect(shogi.hasLegalDrop(state,'sente')).toBe(true);
    expect(checks).toHaveBeenCalledTimes(1);
    state.senteHand=[];
    expect(shogi.hasLegalDrop(state,'sente')).toBe(false);
  });
  it('all-invalid same-type hands are checked once, with exact canonical equivalence',()=>{
    const state=emptyRoot('sente');
    state.squares[8][1].piece=state.squares[6][1].piece; state.squares[6][1].piece=null;
    state.squares[7][2].piece=state.goteHand.splice(state.goteHand.findIndex(p=>p.type==='gold'),1)[0];
    const pawns=state.goteHand.filter(p=>p.type==='pawn');
    state.goteHand=state.goteHand.filter(p=>p.type!=='pawn');
    state.senteHand=pawns.map(p=>({...p,player:'sente'}));
    const checks=vi.spyOn(attacks,'isKingInCheck');
    expect(shogi.getLegalDropSquares(state,state.senteHand[0].id)).toEqual([]);
    const onePieceChecks=checks.mock.calls.length; expect(onePieceChecks).toBeGreaterThan(0);
    checks.mockClear();
    expect(shogi.hasLegalDrop(state,'sente')).toBe(false);
    expect(checks).toHaveBeenCalledTimes(onePieceChecks);
    state.squares[8][1].piece=null;
    expect(shogi.hasLegalDrop(state,'sente')).toBe(true);
  });
});
