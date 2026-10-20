import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Run from the repository root. Read-only; validates the reviewed measurement
// artifacts against both the pre-edit byte manifest and the reviewed Git tree.
const review='docs/benchmarks/tactical-mate-20261019/review-20261020/';
const before=JSON.parse(readFileSync(review+'protected-before.json','utf8'));
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
for(const [file,expected] of Object.entries(before.sha256)) {
  const actual=createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(actual,expected,file+' changed bytes');
  assert.equal(git(['hash-object','--path='+file,file]),git(['rev-parse',before.reviewedSha+':'+file]),file+' differs from reviewed Git blob');
}
const previous=review+'summary-before.json';
assert.equal(git(['hash-object','--path='+previous,previous]),
  git(['rev-parse',before.reviewedSha+':docs/benchmarks/tactical-mate-20261019/run1/summary.json']));
git(['diff','--exit-code',before.reviewedSha,'--','src/domain','src/application','src/workers','src/components','src/types',
  'scripts/benchmarks/tacticalPositions.ts','scripts/measure-tactical-diagnostics.ts']);
console.log(`Unchanged ${Object.keys(before.sha256).length} measurement artifacts (byte SHA-256 + reviewed Git blobs); original summary archived exactly; production, frozen positions and measurement CLI unchanged.`);
