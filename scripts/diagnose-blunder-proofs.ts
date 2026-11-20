import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {extract} from './benchmarks/gameBlunderPilot';
import {prove,digest,type Request} from './benchmarks/outcomeProof';
import {verifyProof} from './benchmarks/verifyOutcomeProof';
import {sha256} from './benchmarks/journalIO';
import {getLegalActions, type LegalAction} from '../src/domain/shogi/legalActions';
import {areLegalActionsEqual} from '../src/domain/shogi/twoPlyAlphaBetaAi';
const [output,priorFile,...paths]=process.argv.slice(2);
assert.ok(output && priorFile && paths.length,'NEW_DIR PRIOR_JSON JOURNALS...');
const before=paths.map(p=>sha256(readFileSync(p)));
const prior=JSON.parse(readFileSync(priorFile,'utf8')) as {results:{id:string;verdict:string;alternative:LegalAction|null}[]};
const chosen=prior.results.filter(r=>r.verdict==='SUSPECTED'); assert.equal(chosen.length,4);
const {games,candidates}=extract(paths); assert.ok(games.every(g=>g.audit.status==='complete'));
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const filesHash=sha256(['scripts/benchmarks/outcomeProof.ts','scripts/benchmarks/verifyOutcomeProof.ts','scripts/diagnose-blunder-proofs.ts'].map(p=>readFileSync(p,'utf8')).join('\n'));
const observations=[];
for(const old of chosen) {
  const c=candidates.find(x=>x.id===old.id); assert.ok(c && old.alternative);
  for(const [kind,savedAction] of [['actual',c.move.action],['alternative',old.alternative]] as const) {
    const candidate=getLegalActions(c.state).find(a=>areLegalActionsEqual(a,savedAction));
    assert.ok(candidate,'saved action must match the legal action enumeration');
    const request:Request={state:c.state,candidate,perspective:c.state.turn,source:{sha,filesHash},limits:{depth:5,nodes:1000,milliseconds:1250,bytes:1048576},order:'forward'};
    const requestHash=digest(request), began=performance.now(),result=prove(request);
    const verification=result.certificate?verifyProof(result.certificate,requestHash,{nodes:1000,milliseconds:1250,bytes:1048576}):null;
    observations.push({journal:c.path,ply:c.move.ply,positionId:c.id,kind,candidate,requestHash,result,verification,elapsedMs:performance.now()-began});
  }
}
const after=paths.map(p=>sha256(readFileSync(p)));assert.deepEqual(before,after);
mkdirSync(resolve(output),{recursive:false});
writeFileSync(resolve(output,'proofs.json'),JSON.stringify({source:{sha,filesHash,dirty:true},limits:{depth:5,nodes:1000,milliseconds:1250,bytes:1048576},before,after,observations},null,2)+'\n',{flag:'wx'});
