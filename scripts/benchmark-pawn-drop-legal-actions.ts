import { createHash } from 'node:crypto';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';

const { positions, sourceSha256 } = replayPositions(SOURCE, TARGETS);
for (const position of positions) {
  const actions = getLegalActions(position.state);
  console.log(JSON.stringify({
    positionId: position.id,
    sourceSha256,
    stateSha256: position.stateSha256,
    count: actions.length,
    actionsSha256: createHash('sha256').update(JSON.stringify(actions)).digest('hex'),
  }));
}
