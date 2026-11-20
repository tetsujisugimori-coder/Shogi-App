// Integration control for a reused second output directory, before either comparison starts.
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { prepare, launch } from './stage-w1b-runner.mjs';
import { read } from './stage-w1b-preflight.mjs';
const [planArg,outArg]=process.argv.slice(2),out=resolve(outArg);mkdirSync(out);
const gate=join(out,'prepared'),prepared=prepare(read(planArg),gate);assert.equal(prepared.status,'READY',JSON.stringify(prepared));
mkdirSync(join(gate,'trial-1'));writeFileSync(join(gate,'trial-1/retained.txt'),'preexisting second result directory\n');
const runner=fileURLToPath(new URL('./stage-w1b-runner.mjs',import.meta.url));
const cli=spawnSync(process.execPath,[runner,'launch',gate],{encoding:'utf8'}),result=JSON.parse(cli.stdout);
writeFileSync(join(out,'stdout.txt'),cli.stdout??'');writeFileSync(join(out,'stderr.txt'),cli.stderr??'');
const comparisonChildren=readdirSync(gate).filter(f=>f.startsWith('event-')).map(f=>read(join(gate,f))).filter(e=>e.action==='spawn'&&e.phase==='run').length;
writeFileSync(join(out,'outcome.json'),JSON.stringify({input:'trial-1 already exists, trial-0 absent',expected:'UNKNOWN / exit 1 / comparison starts 0',actual:result,exitCode:cli.status,comparisonChildren},null,2));
assert.equal(cli.status,1);assert.match(result.reason,/reused trial output/);assert.equal(comparisonChildren,0);
