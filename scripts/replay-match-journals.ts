/** Standalone replay needs only saved journals, never the old plan, search or original parent. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregateJournals, reportSummary } from './benchmarks/matchJournal';

const [output,...inputs]=process.argv.slice(2);
assert.ok(output && inputs.length,'NEW_OUTPUT_DIR JOURNAL [JOURNAL ...]');
const summary=aggregateJournals(inputs.map(p=>resolve(p)));
mkdirSync(output,{recursive:false});
writeFileSync(resolve(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(output,'report.md'),reportSummary(summary),{flag:'wx'});
console.log(JSON.stringify({counts:summary.counts,completedPairs:summary.completedPairs}));
if(summary.counts.corrupt || summary.counts.incomplete)process.exitCode=1;
