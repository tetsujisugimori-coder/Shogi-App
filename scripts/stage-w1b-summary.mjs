import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeFile, classify } from './stage-w1-summary.mjs';

const read = p => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const key = (file, name) => JSON.stringify([normalizeFile(file), name]);
const multiset = entries => { const m = new Map(); for (const k of entries) m.set(k, (m.get(k) || 0) + 1); return m; };

// inventory is the separately collected file/name occurrence list for this exact snapshot.
export function assess(meta, result, inventory, signals = []) {
  const invalid = [], incomplete = [], tests = [], failures = [];
  const bad = s => invalid.push(s), missing = s => incomplete.push(s);
  if (!inventory || !Array.isArray(inventory.tests) || !inventory.tests.length) missing('expected inventory unavailable');
  const usableInventory=Array.isArray(inventory?.tests)&&inventory.tests.every(t=>t&&typeof t.file==='string'&&typeof t.name==='string');
  if(Array.isArray(inventory?.tests)&&!usableInventory) bad('invalid inventory entry');
  if (meta?.provenanceVerified !== true) missing('runner artifact binding unavailable; verified:true alone is insufficient');
  if (!result || typeof result !== 'object' || !Array.isArray(result.testResults)) return {status:'INVALID', invalid:['invalid result structure'], incomplete, failures};
  if (!Number.isInteger(meta?.exitCode)) bad('missing or invalid exit code');
  const fields = ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests','numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numPendingTestSuites'];
  for (const f of fields) if (!Number.isInteger(result[f]) || result[f] < 0) bad(`invalid ${f}`);
  // Not emitted by Vitest 4.1.11 JsonReporter. Validate defensive extensions,
  // but never mistake their absence for evidence of no runtime errors.
  for (const f of ['numRuntimeErrorTestSuites']) if (f in result) {
    if (!Number.isInteger(result[f]) || result[f] < 0) bad(`invalid ${f}`);
    else if (result[f]) bad(`${f} records runtime errors`);
    if (Number.isInteger(result[f]) && result[f] > result.numTotalTestSuites) bad(`${f} exceeds suite total`);
  }
  if ('unhandledErrors' in result) {
    if (!Array.isArray(result.unhandledErrors)) bad('invalid unhandledErrors');
    else if (result.unhandledErrors.length) bad('unhandledErrors records runtime errors');
  }
  if ('numRuntimeErrorTestSuites' in result && Array.isArray(result.unhandledErrors) && Boolean(result.numRuntimeErrorTestSuites) !== Boolean(result.unhandledErrors.length)) bad('runtime error extension counts disagree');
  const runtime = meta?.runtime;
  if (!runtime || !Array.isArray(runtime.suites) || !Array.isArray(runtime.unhandledErrors)) missing('runtime suite/error evidence unavailable');
  else {
    if (runtime.unhandledErrors.length) bad('runtime unhandled errors');
    if(runtime.reason && runtime.reason!=='passed' && runtime.reason!=='failed') missing('runtime did not complete normally');
    const suites=runtime.suites.filter(s=>s&&typeof s==='object');
    if(suites.length!==runtime.suites.length) bad('invalid runtime suite entry');
    if (suites.some(s=>!s || typeof s.id!=='string' || typeof s.file!=='string' || typeof s.mode!=='string' || !['pass','fail','skip','todo','run','queued'].includes(s.state))) bad('invalid runtime suite evidence');
    if (new Set(suites.map(s=>s.id)).size!==suites.length) bad('duplicate runtime suite id');
    const failed=suites.filter(s=>s.state==='fail').length;
    for(const s of suites.filter(s=>s.state==='fail')) failures.push({file:s.file,name:null,kind:'runtime-suite'});
    const pending=suites.filter(s=>s.state==='run'||s.state==='queued'||s.mode==='todo').length;
    for(const [f,n] of Object.entries({numTotalTestSuites:suites.length,numFailedTestSuites:failed,numPendingTestSuites:pending,numPassedTestSuites:suites.length-failed-pending})) if(result[f]!==n) bad(`${f} disagrees with runtime suite tree`);
    if (pending) missing('runtime suites not completed');
    for(const file of result.testResults) {
      if(!file||typeof file.name!=='string') {bad('invalid suite structure');continue;}
      const roots=suites.filter(s=>s.root===true && typeof s.file==='string' && normalizeFile(s.file)===normalizeFile(file.name));
      if(roots.length!==1) bad('missing or duplicate runtime file suite');
      else if(file.status==='passed' && roots[0].state==='fail') bad('passed file has failed runtime suite');
    }
  }
  const seenFiles = new Set();
  for (const suite of result.testResults) {
    if (!suite || typeof suite.name !== 'string' || !Array.isArray(suite.assertionResults)) { bad('invalid suite structure'); continue; }
    const file = normalizeFile(suite.name);
    if(suite.status==='passed' && suite.message) bad(`passed suite has error message: ${file}`);
    if (seenFiles.has(file)) bad(`duplicate suite file: ${file}`); else seenFiles.add(file);
    if (!['passed','failed'].includes(suite.status)) missing(`suite not completed: ${file}`);
    if (suite.status === 'failed') failures.push({file, name:null, kind:'suite'});
    for (const t of suite.assertionResults) {
      if (!t || typeof t.fullName !== 'string' || !['passed','failed','pending','skipped','todo'].includes(t.status)) { bad(`invalid assertion in ${file}`); continue; }
      tests.push({file,name:t.fullName,status:t.status==='skipped'?'pending':t.status});
      if(t.failureMessages!==undefined && (!Array.isArray(t.failureMessages)||t.failureMessages.some(m=>typeof m!=='string'))) bad(`invalid failureMessages in ${file}`);
      else if(t.status==='passed' && t.failureMessages?.length) bad(`passed assertion has failure messages: ${file}`);
      if (t.status === 'failed') failures.push({file,name:t.fullName,kind:'test'});
    }
    if (suite.status === 'passed' && suite.assertionResults.some(t => t?.status === 'failed')) bad(`passed suite contains failure: ${file}`);
  }
  const count = status => tests.filter(t => t.status === status).length;
  for (const [field,status] of [['numPassedTests','passed'],['numFailedTests','failed'],['numPendingTests','pending'],['numTodoTests','todo']]) if (Number.isInteger(result[field]) && result[field] !== count(status)) bad(`${field} disagrees with assertions`);
  if (Number.isInteger(result.numTotalTests) && result.numTotalTests !== tests.length) bad('numTotalTests disagrees with assertions');
  if (result.numTotalTestSuites !== result.numPassedTestSuites + result.numFailedTestSuites + result.numPendingTestSuites) bad('suite aggregate counts disagree');
  // Each file is a suite, but nested/empty describes also count: never assume equality.
  if (result.numTotalTestSuites < seenFiles.size) bad('suite total below file suite count');
  if (result.numFailedTestSuites < result.testResults.filter(s=>s?.status==='failed').length) bad('failed suite count below failed file count');
  if (result.numFailedTestSuites && result.testResults.every(s=>s?.status==='passed')) bad('failed suites without failed file result');
  if (!tests.length) missing('zero tests');
  if (count('pending') || count('todo')) missing('skipped or todo tests lack independently verified planned status');
  if (usableInventory) {
    const expected = multiset(inventory.tests.map(t => key(t.file,t.name)));
    const actual = multiset(tests.map(t => key(t.file,t.name)));
    for (const [k,n] of expected) if ((actual.get(k)||0) < n) missing(`missing ${n-(actual.get(k)||0)} occurrence(s): ${k}`);
    for (const [k,n] of actual) if ((expected.get(k)||0) < n) bad(`unexpected ${n-(expected.get(k)||0)} occurrence(s): ${k}`);
  }
  if (failures.length && meta?.exitCode === 0) bad('failures with zero exit code');
  if (!failures.length && meta?.exitCode !== 0) bad('nonzero exit without recorded test failure');
  if (typeof result.success !== 'boolean') bad('invalid success field');
  else if (result.success !== (meta?.exitCode === 0 && failures.length === 0)) bad('success disagrees with exit code or failures');
  if (signals.length) bad('abnormal log signals');
  // Preserve actual failures even if there are contradictory records.
  const status = failures.length ? 'FAIL' : invalid.length ? 'INVALID' : incomplete.length ? 'INCOMPLETE' : 'PASS';
  return {status, invalid, incomplete, failures, counts:{total:tests.length, passed:count('passed'),failed:count('failed'),skipped:count('pending'),todo:count('todo')}, tests};
}

function main(dir, inventoryFile, output) {
  const inventories = read(inventoryFile); mkdirSync(output);
  const runs = [];
  for (const name of readdirSync(dir).filter(n => /^run-\d\d$/.test(n)).sort()) {
    const p = join(dir,name); let meta, result;
    try { meta = read(join(p,'run.json')); } catch { runs.push({name,status:'INCOMPLETE',reason:'missing or invalid run metadata'}); continue; }
    if(!meta||typeof meta!=='object'||Array.isArray(meta)) {runs.push({name,status:'INVALID',reason:'invalid run metadata structure'});continue;}
    const resultPath = join(p,'vitest.json');
    if (!existsSync(resultPath)) { runs.push({name,status:'INCOMPLETE',reason:'missing result'}); continue; }
    try { result = read(resultPath); } catch { runs.push({name,status:'INVALID',reason:'malformed result JSON'}); continue; }
    const absent = ['stdout.log','stderr.log'].filter(f => !existsSync(join(p,f)));
    const signals = ['stdout.log','stderr.log'].filter(f=>!absent.includes(f)).flatMap(f=>readFileSync(join(p,f),'utf8').split(/\r?\n/).filter(l=>/unhandled (?:rejection|error)|AbortError|worker.*(?:crash|exit)/i.test(l)).map(line=>({file:f,line,classification:classify(line)})));
    // Standalone imported JSON has no runner custody. Ignore self-asserted trust.
    const assessed = assess({...meta,provenanceVerified:false,runtime:undefined},result,inventories?.[meta.head],signals);
    if (absent.length) { if(assessed.status==='PASS') assessed.status='INCOMPLETE'; assessed.incomplete.push(`missing logs: ${absent.join(', ')}`); }
    const {tests,...summary} = assessed;
    runs.push({name,head:meta.head,exitCode:meta.exitCode,...summary,signals});
  }
  writeFileSync(join(output,'comparison-summary.json'),JSON.stringify({runs},null,2)+'\n',{flag:'wx'});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2],process.argv[3],process.argv[4]);
