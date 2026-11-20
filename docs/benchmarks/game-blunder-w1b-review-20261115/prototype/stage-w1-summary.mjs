import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function classify(message) {
  const s = String(message);
  if (/test timed out|hook timed out/i.test(s)) return 'runner-timeout';
  if (/unable to find (?:an? (?:accessible )?element|element|role=)|found multiple elements/i.test(s)) return 'UI-query-failure';
  if (/AbortError/i.test(s)) return 'AbortError';
  if (/unhandled (?:rejection|error)/i.test(s)) return 'unhandled-rejection';
  if (/worker.*(?:crash|exit)/i.test(s)) return 'worker-crash';
  if (/AssertionError|expected .* to /i.test(s)) return 'assertion-failure';
  return 'unknown';
}

export function normalizeFile(file) {
  const normalized = file.replaceAll('\\', '/');
  const match = normalized.match(/\/stage-w1-snapshots\/(?:old|new)\/(.*)$/);
  return match ? match[1] : normalized;
}

export function summarizeRun(meta, result) {
  const tests = [], failures = [];
  for (const suite of result.testResults ?? []) {
    const file = normalizeFile(suite.name);
    for (const test of suite.assertionResults ?? []) {
      const messages = test.failureMessages ?? [];
      const item = { file, name: test.fullName, status: test.status, durationMs: test.duration ?? null,
        start: 'NOT_MEASURED', end: 'NOT_MEASURED', worker: 'NOT_MEASURED', timeout: messages.some(m => classify(m) === 'runner-timeout') };
      tests.push(item);
      if (test.status === 'failed') failures.push({ file, name: test.fullName, primary: messages.length ? classify(messages[0]) : 'unknown', detectedSignals: [...new Set(messages.flatMap(m => [classify(m), ...(/AbortError/i.test(m) ? ['AbortError'] : []), ...(/unhandled (?:rejection|error)/i.test(m) ? ['unhandled-rejection'] : [])]))], messages });
    }
    if (suite.status === 'failed' && !(suite.assertionResults ?? []).some(t => t.status === 'failed')) failures.push({ file, name: null, primary: classify(suite.message ?? ''), messages: [suite.message ?? 'suite failure'] });
  }
  return { sequence: meta.sequence, head: meta.head, exitCode: meta.exitCode, processSampling: meta.processSampling,
    passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests, todo: result.numTodoTests,
    tests, failures };
}

function main(dir, output) {
  mkdirSync(output); // Refuse to replace prior aggregation.
  const runs = [];
  for (const name of readdirSync(dir).filter(n => /^run-\d\d$/.test(n)).sort()) {
    const path = join(dir, name), metaPath = join(path, 'run.json');
    if (!existsSync(metaPath)) { runs.push({sequence:Number(name.slice(-2)), status:'INCOMPLETE'}); continue; }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8').replace(/^\uFEFF/, ''));
    const resultPath = join(path, 'vitest.json');
    const logs = ['stdout.log','stderr.log'].flatMap(f => existsSync(join(path,f)) ? readFileSync(join(path,f),'utf8').split(/\r?\n/).filter(l => /unhandled (?:rejection|error)|AbortError|worker.*(?:crash|exit)/i.test(l)).map(line => ({file:f,line,classification:classify(line)})) : []);
    if (!existsSync(resultPath)) { runs.push({ ...meta, status: 'NO_RESULT', logSignals:logs }); continue; }
    const run = summarizeRun(meta, JSON.parse(readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, '')));
    run.logSignals = logs;
    run.status = meta.exitCode === 0 && run.failed === 0 && !logs.length ? 'PASS' : 'NONPASS_OR_SIGNAL';
    writeFileSync(join(output, `${name}-test-timing.jsonl`), run.tests.map(t => JSON.stringify(t)).join('\n') + '\n', {flag:'wx'});
    runs.push(run);
  }
  const sets = Object.fromEntries(['old','new'].map(h => [h,new Set(runs.filter(r => r.head === h).flatMap(r => (r.tests ?? []).map(t => JSON.stringify([t.file,t.name]))))]));
  const common = [...sets.old].filter(k => sets.new.has(k));
  const changed = new Set(['src/test/game-blunder-investigation-v4.test.ts','src/test/game-blunder-v4-journal-integration.test.ts']);
  const sameFile = common.filter(k => !changed.has(JSON.parse(k)[0]));
  const compact = runs.map(({tests, failures, ...r}) => ({ ...r, failureCount: failures?.length ?? null, commonNameFailures: failures?.filter(f=>common.includes(JSON.stringify([f.file,f.name]))).length ?? null, unchangedFileNameFailures: failures?.filter(f=>sameFile.includes(JSON.stringify([f.file,f.name]))).length ?? null }));
  writeFileSync(join(output, 'comparison-summary.json'), JSON.stringify({generatedAt:new Date().toISOString(), runs:compact, observedNames:{common:common.length,commonInUnchangedFiles:sameFile.length,onlyOld:[...sets.old].filter(k=>!sets.new.has(k)).map(JSON.parse),onlyNew:[...sets.new].filter(k=>!sets.old.has(k)).map(JSON.parse), changedFiles:[...changed]}, limitations:['Observed names are not proof of additions or removals when collection is incomplete','Name sets collapse duplicate names; per-test timing preserves occurrences','Log string matches require manual verification and do not establish order or causality','Individual start/end and worker ID are NOT_MEASURED','Unchanged file does not prove identical runtime context','Sampling assignment is confounded with order']}, null, 2) + '\n', {flag:'wx'});
  writeFileSync(join(output, 'failure-classification.json'), JSON.stringify(runs.map(r => ({sequence:r.sequence, head:r.head, failures:r.failures ?? null, logSignals:r.logSignals ?? null})), null, 2) + '\n', {flag:'wx'});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2], process.argv[3]);
