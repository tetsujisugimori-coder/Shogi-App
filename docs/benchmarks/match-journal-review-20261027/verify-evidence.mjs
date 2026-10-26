import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { sha256, parse } from '../../../scripts/benchmarks/journalIO.ts';

const root='docs/benchmarks/match-journal-review-20261027';
const old='docs/benchmarks/match-journal-20261026';
const reviewed='3adec10bfc55ee681c3f79bb36dddbe5530a6166';
const baseline='4009cd0e808553af8f0ec9e01411a3eb6714560d';
const measured='05cbb8cdfe3b7574a630d22a3dfb9a75d379fdcb';
const readJSON=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const lf=bytes=>Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
const sameContent=(a,b)=>a.equals(b)||(!a.includes(0)&&!b.includes(0)&&Buffer.from(a.toString('utf8')).equals(a)&&Buffer.from(b.toString('utf8')).equals(b)&&lf(a).equals(lf(b)));
function gitBlobs(ref,paths) {
  const found=new Map();
  for(let begin=0;begin<paths.length;begin+=64){
    const chunk=paths.slice(begin,begin+64);
    const bytes=execFileSync('git',['cat-file','--batch'],{input:chunk.map(p=>`${ref}:${p}`).join('\n')+'\n',maxBuffer:128*1024*1024});
    let offset=0;
    for(const path of chunk){const end=bytes.indexOf(10,offset),header=bytes.subarray(offset,end).toString().split(' ');
      assert.equal(header[1],'blob',path);const length=Number(header[2]);found.set(path,bytes.subarray(end+1,end+1+length));offset=end+1+length+1;}
    assert.equal(offset,bytes.length);
  }
  return found;
}
const originals=readJSON(old+'/protected-originals.json'),manifest=readJSON(old+'/manifest.json');
assert.equal(Object.keys(originals).length,1087);assert.equal(Object.keys(manifest).length,329);
const reviewedManifest=gitBlobs(reviewed,[old+'/manifest.json',old+'/protected-originals.json']);
for(const [path,bytes] of reviewedManifest)assert.ok(fs.readFileSync(path).equals(bytes),'old manifest changed '+path);
const baseBytes=gitBlobs(baseline,Object.keys(originals)),newlineOnly=[];
for(const [path,expected] of Object.entries(originals)){
  const current=fs.readFileSync(path),base=baseBytes.get(path);assert.ok(sameContent(current,base),'content differs from baseline '+path);
  if(sha256(current)!==expected){
    assert.ok(!current.includes(0)&&!base.includes(0)&&
      [sha256(base),sha256(lf(base)),sha256(lf(base).toString().replaceAll('\n','\r\n'))].includes(expected),'original bytes differ beyond newline conversion '+path);
    newlineOnly.push({path,expected,current:sha256(current),baseline:sha256(base)});
  }
}
for(const [path,hash] of Object.entries(manifest))assert.equal(sha256(fs.readFileSync(old+'/'+path)),hash,'old evidence changed '+path);
const plan=parse(fs.readFileSync(old+'/run1/plan.json','utf8')),hashes=plan.games[0].sourceHashes;
assert.equal(plan.sourceSha,measured);
const measuredSources=gitBlobs(measured,Object.keys(hashes)),changedSources=[];
for(const [path,hash] of Object.entries(hashes)){
  assert.equal(sha256(gunzipSync(fs.readFileSync(old+'/run1/sources/'+path+'.gz'))),hash,'snapshot changed '+path);
  assert.equal(sha256(lf(measuredSources.get(path))),hash,'snapshot vs measured commit '+path);
  const current=sha256(lf(fs.readFileSync(path)));
  if(current!==hash)changedSources.push({path,measured:hash,current});
}
assert.deepEqual(changedSources.map(s=>s.path),['scripts/benchmarks/matchJournal.ts']);
const testPath='src/test/match-journal.test.ts',currentTest=lf(fs.readFileSync(testPath)).toString();
const red=lf(gunzipSync(fs.readFileSync(root+'/before-sources/src__test__match-journal.test.ts.gz'))).toString();
const marker="describe('journal timed search contract',()=>{";
assert.equal(currentTest.split(marker)[1].split('\n  function observation')[0].trim(),red.split(marker)[1].split('\n});')[0].trim(),'red expectations changed');
const oldTests=lf(gitBlobs(reviewed,[testPath]).get(testPath)).toString(),existing="describe('durable per-ply journal',()=>{";
assert.equal(currentTest.split(existing)[1],oldTests.split(existing)[1],'existing tests/timeout changed');
for(const file of ['summary.json','report.md']){
  const reference=fs.readFileSync(old+'/audit1/'+file);
  for(const dir of [old+'/audit2',root+'/audit1',root+'/audit2'])assert.ok(fs.readFileSync(dir+'/'+file).equals(reference),'reaggregation changed '+dir+'/'+file);
}
for(const snapshot of readJSON(root+'/environment-and-sources.json').auditSourceSnapshots){
  const bytes=fs.readFileSync(snapshot.snapshot);
  assert.equal(sha256(bytes),snapshot.compressedHash,'audit snapshot changed');
  assert.equal(sha256(gunzipSync(bytes)),snapshot.normalizedLFHash,'audit source changed');
  assert.equal(sha256(lf(fs.readFileSync(snapshot.source))),snapshot.normalizedLFHash,'current vs audited source');
}
const preservation={reviewed,baseline,measured,oldOriginals:1087,oldEvidence:329,oldManifestHash:sha256(fs.readFileSync(old+'/manifest.json')),
  newlineOnly,measuredSnapshots:Object.keys(hashes).length,changedSources,redExpectationsUnchanged:true,existingTestsUnchanged:true,
  currentTestHash:sha256(lf(fs.readFileSync(testPath))),verified:true};
const walk=dir=>fs.readdirSync(dir).flatMap(name=>{const path=dir+'/'+name;return fs.statSync(path).isDirectory()?walk(path):[path];});
const [mode,output]=process.argv.slice(2);
if(mode==='inspect'){
  assert.ok(output,'inspect NEW_REPORT');fs.writeFileSync(output,JSON.stringify(preservation,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(preservation));
}else if(mode==='seal'){
  const hashes=Object.fromEntries(walk(root).filter(p=>p!==root+'/manifest.json').sort().map(p=>[p.slice(root.length+1),sha256(fs.readFileSync(p))]));
  fs.writeFileSync(root+'/manifest.json',JSON.stringify(hashes,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:Object.keys(hashes).length,hash:sha256(fs.readFileSync(root+'/manifest.json'))}));
}else if(mode==='verify'||mode==='verify-index'){
  const hashes=readJSON(root+'/manifest.json'),paths=Object.keys(hashes).map(p=>root+'/'+p);
  assert.deepEqual(walk(root).filter(p=>p!==root+'/manifest.json').sort(),paths.sort());
  const blobs=mode==='verify-index'?gitBlobs('',paths):null;
  for(const [p,h] of Object.entries(hashes))assert.equal(sha256(blobs?blobs.get(root+'/'+p):fs.readFileSync(root+'/'+p)),h,p);
  console.log(JSON.stringify({verified:true,mode,oldOriginals:1087,oldEvidence:329,newEvidence:paths.length,newlineOnly:newlineOnly.length}));
}else throw Error('inspect NEW_REPORT | seal | verify | verify-index');
