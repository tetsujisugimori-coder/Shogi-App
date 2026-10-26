/** Small deterministic test inputs, separate from the frozen 1000ms plan. */
import { constructed } from './tacticalPositions';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import type { StartRecord, Search } from './matchJournal';

export function fixtureStart(overrides: Partial<StartRecord> = {}): StartRecord {
  return { type:'start',runId:'fixture-run',pairId:'fixture-pair',gameId:'fixture-1',sourceSha:'0'.repeat(40),
    sourceHashes:{fixture:'0'.repeat(64)},seats:{sente:'legacy',gote:'experimental'},
    initialState:constructed('journal-kings',[[8,4,'king','sente'],[0,4,'king','gote']]),
    startedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:'test'},
    conditions:{timeMs:1000,depth:1,maxPlies:3,gameMs:10000,hardGameMs:20000,runMs:60000,maxBytes:1024*1024,reserveBytes:65536,stopAfter:null,
      options:{moveOrdering:'standard',killerMoves:false,usePreviousIterationPv:false,useTranspositionTable:false,
        quiescence:{maxTacticalDepth:1,moveOrdering:'original',includeQuietPromotions:false,maxCheckEvasionExtensions:0}}},...overrides };
}
export const fixtureSearch: Search = (state,mode) => analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,1,1000,{pieceSafetyMode:mode},()=>0,fixtureStart().conditions.options);
