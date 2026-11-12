import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, normalizeFile, summarizeRun } from './stage-w1-summary.mjs';

test('classifies common failures without inventing a timeout', () => {
  assert.equal(classify('Test timed out in 5000ms'), 'runner-timeout');
  assert.equal(classify('Unable to find an element with the text'), 'UI-query-failure');
  assert.equal(classify('Unable to find an accessible element with the role'), 'UI-query-failure');
  assert.equal(classify('Unable to find role="button"'), 'UI-query-failure');
  assert.equal(classify('AssertionError: expected 1 to equal 2'), 'assertion-failure');
  assert.equal(classify('AbortError'), 'AbortError');
  assert.equal(classify('unexpected message'), 'unknown');
});

test('preserves duplicates and leaves unobserved timing and worker unknown', () => {
  const run = summarizeRun({sequence:1,head:'old',exitCode:1}, {numPassedTests:0,numFailedTests:2,numPendingTests:0,testResults:[{name:'C:/x/stage-w1-snapshots/old/src/test/a.test.ts',status:'failed',assertionResults:[{fullName:'same',status:'failed',failureMessages:['Test timed out']},{fullName:'same',status:'failed',failureMessages:['oops']}]}]});
  assert.equal(run.tests.length, 2);
  assert.deepEqual(run.failures.map(f => f.primary), ['runner-timeout', 'unknown']);
  assert.equal(run.tests[0].start, 'NOT_MEASURED');
  assert.equal(run.tests[0].worker, 'NOT_MEASURED');
  assert.equal(normalizeFile('C:\\x\\stage-w1-snapshots\\new\\src\\a.ts'), 'src/a.ts');
});
