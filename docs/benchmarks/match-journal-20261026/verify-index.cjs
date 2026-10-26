// Verify new evidence from Git index blobs, independently of checkout line endings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = 'docs/benchmarks/match-journal-20261026';
const manifest = JSON.parse(fs.readFileSync(root + '/manifest.json', 'utf8'));
const entries = Object.entries(manifest);
const input = entries.map(([path]) => ':' + root + '/' + path).join('\n') + '\n';
const bytes = cp.execFileSync('git', ['cat-file', '--batch'], { input, maxBuffer: 64 * 1024 * 1024 });
let offset = 0;
for (const [path, expected] of entries) {
  const end = bytes.indexOf(10, offset);
  const header = bytes.subarray(offset, end).toString().split(' ');
  assert.equal(header[1], 'blob', path + ' not staged');
  const length = Number(header[2]);
  const content = bytes.subarray(end + 1, end + 1 + length);
  assert.equal(crypto.createHash('sha256').update(content).digest('hex'), expected, path);
  offset = end + 1 + length + 1;
}
assert.equal(offset, bytes.length);
console.log(JSON.stringify({ gitIndexVerified: true, evidenceFiles: entries.length }));
