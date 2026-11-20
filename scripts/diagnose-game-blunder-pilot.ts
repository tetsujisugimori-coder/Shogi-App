import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { extract, compare } from './benchmarks/gameBlunderPilot';
import { stateHash } from './benchmarks/matchJournal';
const [output,...paths] = process.argv.slice(2);
if (!output || !paths.length) throw Error('NEW_OUTPUT_DIR JOURNAL...');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const {games,candidates} = extract(paths);
// Interleave games so an early, long game cannot consume the entire budget.
const groups=paths.map(path=>candidates.filter(c=>c.path===path));
const selected: typeof candidates = [];
for (let i=0; selected.length<24 && groups.some(g=>i<g.length); i++) {
  for (const g of groups) if (g[i] && selected.length<24) selected.push(g[i]);
}
const began=performance.now(), results=[];
for (const c of selected) {
  // A synchronous engine operation can overrun its cooperative deadline.
  if (performance.now()-began >= 120000) break;
  results.push({id:c.id, journal:c.path, journalSha256:c.hash, positionHash:stateHash(c.state),
    ply:c.move.ply, moveNumber:c.move.moveNumber, player:c.move.player, action:c.move.action, next:c.next.action,
    recordedSearch:c.move.search, conditions:c.conditions, mode:c.mode, categories:['A'], ...compare(c)});
}
const summary = {method:'pilot: next-ply capture of the moved piece', sourceHead:head, workingTree:'uncommitted diagnostic source', maxPositions:24, referenceBudgetMs:1000, maxDepth:4, softTotalMs:120000, elapsedMs:performance.now()-began,
  games:games.map(({path,audit})=>({path,hash:audit.hash,status:audit.status,error:audit.error,plies:audit.moves.length,end:audit.end?.reason})),
  triggers:candidates.length, analyzed:results.length, results};
mkdirSync(resolve(output),{recursive:false});
writeFileSync(resolve(output,'candidates.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(output,'report.md'),`# 実戦棋譜の予備診断\n\n対象 ${games.length} 局、候補 ${candidates.length}、参照探索 ${results.length}。直後に移動駒が取られた手を機械的に抽出した候補であり、駒損や悪手の証明ではない。\n\n` + results.map(r=>`- ${r.journal} ${r.ply}手: ${r.verdict}; ${r.reason} 差=${r.delta}`).join('\n')+'\n',{flag:'wx'});
