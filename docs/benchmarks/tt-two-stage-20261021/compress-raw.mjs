import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
const root=dirname(fileURLToPath(import.meta.url));
function compress(raw) {
  const compressed=raw+'.gz';
  if(!existsSync(raw)) { assert.ok(existsSync(compressed)); return; }
  const original=readFileSync(raw);
  if(!existsSync(compressed)) writeFileSync(compressed,gzipSync(original),{flag:'wx'});
  assert.deepEqual(gunzipSync(readFileSync(compressed)),original);
  unlinkSync(raw);
}
for(const run of ['probe','run1','diagnostic']) compress(join(root,run,'raw.jsonl'));
for(const name of readdirSync(join(root,'validation'))) {
  if(name.endsWith('.txt') || name.endsWith('.json')) compress(join(root,'validation',name));
}
console.log('Verified lossless gzip copies of new raw journals and validation originals.');
