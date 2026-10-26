const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='docs/benchmarks/piece-safety-20261025';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const canonical=s=>s.replaceAll('\r\n','\n');
const sourceFiles=['README.md','LOG.md','.gitattributes','.gitignore','scripts/diagnose-piece-safety.ts','scripts/measure-piece-safety.ts','scripts/report-piece-safety.ts','scripts/measure-piece-safety-cost.ts','scripts/check-piece-safety-budgets.cjs','scripts/seal-piece-safety.cjs','scripts/benchmarks/pieceSafetyPositions.ts','src/test/shogi-piece-safety-experiment.test.ts','src/domain/shogi/undefendedPieceSafetyEvaluation.ts','src/domain/shogi/twoPlyMinimaxAi.ts','src/domain/shogi/twoPlyAlphaBetaAi.ts'];
// Only these ordinary Git text files use LF-normalized hashes. Evidence and
// protected originals always use byte-exact hashes; .gitattributes preserves them.
const evidenceHash=f=>sourceFiles.includes(f.replaceAll('\\','/'))?crypto.createHash('sha256').update(canonical(fs.readFileSync(f,'utf8'))).digest('hex'):hash(f);
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const [mode,original]=process.argv.slice(2);
if(mode==='protect'){
  const entries=Object.fromEntries(files(original).sort().map(f=>[f,hash(f)]));
  fs.writeFileSync(path.join(root,'protected-originals.json'),JSON.stringify(entries)+'\n',{flag:'wx'});console.log(JSON.stringify({protected:Object.keys(entries).length}));
}else if(mode==='seal'){
  const target=path.join(root,'evidence-manifest.json');
  const entries=Object.fromEntries([...files(root).filter(f=>path.resolve(f)!==path.resolve(target)),...sourceFiles].sort().map(f=>[f.replaceAll('\\','/'),evidenceHash(f)]));
  fs.writeFileSync(target,JSON.stringify(entries)+'\n');console.log(JSON.stringify({sealed:Object.keys(entries).length,manifestSha256:hash(target)}));
}else if(mode==='verify'||mode==='verify-evidence'){
  const originals=mode==='verify'?JSON.parse(fs.readFileSync(path.join(root,'protected-originals.json'),'utf8')):{};
  const entries=JSON.parse(fs.readFileSync(path.join(root,'evidence-manifest.json'),'utf8'));
  for(const [f,h] of Object.entries(originals))assert.equal(hash(f),h,f);
  for(const [f,h] of Object.entries(entries))assert.equal(evidenceHash(f),h,f);
  const plan=JSON.parse(fs.readFileSync(path.join(root,'run2/plan.json'),'utf8'));
  for(const [f,h] of Object.entries(plan.hashes)){
    const measured=require('node:zlib').gunzipSync(fs.readFileSync(path.join(root,'run2',f.replaceAll('/','__')+'.gz'))).toString();
    assert.equal(crypto.createHash('sha256').update(measured).digest('hex'),h);
    if(canonical(fs.readFileSync(f,'utf8'))===canonical(measured))continue;
    // Measurement archive stays immutable. Only the post-run JSON persistence
    // comparison was repaired; all product, fixture and test bytes must match.
    assert.equal(f,'scripts/measure-piece-safety.ts','final source differs from measured source '+f);
    const corrected=measured.replace('assert.deepEqual(state,g.result.finalState)','assert.deepEqual(JSON.parse(json(state)),g.result.finalState)');
    assert.notEqual(corrected,measured);assert.equal(canonical(fs.readFileSync(f,'utf8')),canonical(corrected),'unexpected harness change');
  }
  console.log(JSON.stringify({valid:true,originals:Object.keys(originals).length,evidence:Object.keys(entries).length,sourceFiles:Object.keys(plan.hashes).length}));
}else throw Error('protect ORIGINAL_DIR | seal | verify | verify-evidence');
