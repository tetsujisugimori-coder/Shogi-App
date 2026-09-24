import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { getLegalActions, getQuiescenceLegalActionsWithDiagnostics } from '../src/domain/shogi/legalActions';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';

const [mode, path] = process.argv.slice(2);
assert.ok((mode === '--save' || mode === '--compare') && path,
  'Usage: tsx scripts/measure-q-board-legal-actions.ts --save|--compare PATH.json');
const { positions, sourceSha256 } = replayPositions(SOURCE, TARGETS);
const current = {
  sourceSha256,
  positions: positions.map(position => {
    const actions = getLegalActions(position.state);
    assert.deepEqual(getQuiescenceLegalActionsWithDiagnostics(position.state,
      new SearchDiagnostics(false, false)), actions, `${position.id}: diagnostic order`);
    return { id: position.id, stateSha256: position.stateSha256, actions };
  }),
};
if (mode === '--save') writeFileSync(path, JSON.stringify(current) + '\n', { flag: 'wx' });
else assert.deepEqual(current, JSON.parse(readFileSync(path, 'utf8')),
  'complete legal action arrays differ from the saved main baseline');
for (const position of current.positions) {
  const sha256 = createHash('sha256').update(JSON.stringify(position.actions)).digest('hex');
  console.log(`${position.id}: ${position.actions.length} actions, sha256=${sha256}`);
}
