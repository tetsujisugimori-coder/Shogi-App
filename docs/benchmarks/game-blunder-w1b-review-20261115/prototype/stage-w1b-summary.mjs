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
  if (!inventory || inventory.verified !== true || !Array.isArray(inventory.tests) || !inventory.tests.length) missing('expected inventory unavailable or unverified');
  if (!result || typeof result !== 'object' || !Array.isArray(result.testResults)) return {status:'INVALID', invalid:['invalid result structure'], incomplete, failures};
  if (!Number.isInteger(meta?.exitCode)) bad('missing or invalid exit code');
  const fields = ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests','numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numPendingTestSuites'];
  for (const f of fields) if (!Number.isInteger(result[f]) || result[f] < 0) bad(`invalid ${f}`);
  const seenFiles = new Set();
  for (const suite of result.testResults) {
    if (!suite || typeof suite.name !== 'string' || !Array.isArray(suite.assertionResults)) { bad('invalid suite structure'); continue; }
    const file = normalizeFile(suite.name);
    if (seenFiles.has(file)) bad(`duplicate suite file: ${file}`); else seenFiles.add(file);
    if (!['passed','failed'].includes(suite.status)) missing(`suite not completed: ${file}`);
    if (suite.status === 'failed') failures.push({file, name:null, kind:'suite'});
    for (const t of suite.assertionResults) {
      if (!t || typeof t.fullName !== 'string' || !['passed','failed','pending','todo'].includes(t.status)) { bad(`invalid assertion in ${file}`); continue; }
      tests.push({file,name:t.fullName,status:t.status});
      if (t.status === 'failed') failures.push({file,name:t.fullName,kind:'test'});
    }
    if (suite.status === 'passed' && suite.assertionResults.some(t => t?.status === 'failed')) bad(`passed suite contains failure: ${file}`);
  }
  const count = status => tests.filter(t => t.status === status).length;
  for (const [field,status] of [['numPassedTests','passed'],['numFailedTests','failed'],['numPendingTests','pending'],['numTodoTests','todo']]) if (Number.isInteger(result[field]) && result[field] !== count(status)) bad(`${field} disagrees with assertions`);
  if (Number.isInteger(result.numTotalTests) && result.numTotalTests !== tests.length) bad('numTotalTests disagrees with assertions');
  if (result.numTotalTestSuites !== result.numPassedTestSuites + result.numFailedTestSuites + result.numPendingTestSuites) bad('suite aggregate counts disagree');
  if (!tests.length) missing('zero tests');
  if (count('pending') || count('todo')) missing('skipped or todo tests lack independently verified planned status');
  if (inventory?.verified === true && Array.isArray(inventory.tests)) {
    const expected = multiset(inventory.tests.map(t => key(t.file,t.name)));
    const actual = multiset(tests.map(t => key(t.file,t.name)));
    for (const [k,n] of expected) if ((actual.get(k)||0) < n) missing(`missing ${n-(actual.get(k)||0)} occurrence(s): ${k}`);
    for (const [k,n] of actual) if ((expected.get(k)||0) < n) bad(`unexpected ${n-(expected.get(k)||0)} occurrence(s): ${k}`);
  }
  if (failures.length && meta.exitCode === 0) bad('failures with zero exit code');
  if (!failures.length && meta.exitCode !== 0) bad('nonzero exit without recorded test failure');
  if (typeof result.success !== 'boolean') bad('invalid success field');
  else if (result.success !== (meta.exitCode === 0 && failures.length === 0)) bad('success disagrees with exit code or failures');
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
    const resultPath = join(p,'vitest.json');
    if (!existsSync(resultPath)) { runs.push({name,status:'INCOMPLETE',reason:'missing result'}); continue; }
    try { result = read(resultPath); } catch { runs.push({name,status:'INVALID',reason:'malformed result JSON'}); continue; }
    const absent = ['stdout.log','stderr.log'].filter(f => !existsSync(join(p,f)));
    const signals = ['stdout.log','stderr.log'].filter(f=>!absent.includes(f)).flatMap(f=>readFileSync(join(p,f),'utf8').split(/\r?\n/).filter(l=>/unhandled (?:rejection|error)|AbortError|worker.*(?:crash|exit)/i.test(l)).map(line=>({file:f,line,classification:classify(line)})));
    const assessed = assess(meta,result,inventories[meta.head],signals);
    if (absent.length && assessed.status === 'PASS') { assessed.status='INCOMPLETE'; assessed.incomplete.push(`missing logs: ${absent.join(', ')}`); }
    const {tests,...summary} = assessed;
    runs.push({name,head:meta.head,exitCode:meta.exitCode,...summary,signals});
  }
  writeFileSync(join(output,'comparison-summary.json'),JSON.stringify({runs},null,2)+'\n',{flag:'wx'});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2],process.argv[3],process.argv[4]);
