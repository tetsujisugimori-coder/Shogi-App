// Demonstrate that the dedicated CI suite detects a verifier forced to return false PASS.
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=mkdtempSync(join(process.env.W1C_FIXTURES??tmpdir(),'shogi-w1c-mutant-'));
for(const name of ['stage-w1b-summary-check.mjs','stage-w1-summary.mjs']) copyFileSync(new URL(name,import.meta.url),join(root,name));
const original=readFileSync(new URL('stage-w1b-summary.mjs',import.meta.url),'utf8');
const mutant=original.replace('return {status, invalid, incomplete, failures, counts:',"return {status:'PASS', invalid, incomplete, failures, counts:");
if(mutant===original)throw Error('mutation not applied');
writeFileSync(join(root,'stage-w1b-summary.mjs'),mutant);
const r=spawnSync(process.execPath,['--test',join(root,'stage-w1b-summary-check.mjs')],{encoding:'utf8'});
writeFileSync(join(root,'stdout.txt'),r.stdout??'');writeFileSync(join(root,'stderr.txt'),r.stderr??'');
const result={mutation:'force final aggregate status PASS',expected:'regression process exit 1',exitCode:r.status,detected:r.status===1&&/fail [1-9]/.test(r.stdout),retained:root};
console.log(JSON.stringify(result));
if(!result.detected)process.exitCode=1;
