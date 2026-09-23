import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInitialBoardState } from '../src/types/shogi';
import { areLegalActionsEqual } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { executeLegalAction, getLegalActions } from '../src/domain/shogi/legalActions';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { summarizeGames, type MeasurementConfig, type MeasurementGame } from './benchmarks/timedFallbackSelfPlay';

const path = process.argv[2];
if (!path) throw new Error('Usage: npm run audit:timed-fallback-self-play -- PATH.jsonl');
const rows = readFileSync(resolve(path), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const configRow = rows[0] as { type: string; config: MeasurementConfig };
assert.equal(configRow.type, 'config');
const games = rows.filter(row => row.type === 'game') as MeasurementGame[];
assert.equal(games.length, configRow.config.pairCount * 2);
for (const [index, game] of games.entries()) {
  assert.equal(game.executionIndex, index + 1);
  assert.equal(game.pairNumber, Math.floor(index / 2) + 1);
  assert.equal(game.gameNumber, index % 2 + 1);
  const expectedSente = (index % 4 === 0 || index % 4 === 3) ? 'A' : 'B';
  assert.equal(game.sente, expectedSente);
  assert.equal(game.gote, expectedSente === 'A' ? 'B' : 'A');
  let state = createInitialBoardState();
  for (const [plyIndex, ply] of game.plies.entries()) {
    assert.equal(ply.ply, plyIndex + 1);
    assert.equal(ply.player, state.turn);
    assert.equal(ply.participant, game[ply.player]);
    assert.equal(ply.positionKey, createPositionKey(state));
    assert.equal(ply.timeLimitMilliseconds, configRow.config.timeLimitMilliseconds);
    assert.ok(Number.isFinite(ply.elapsedMilliseconds) && ply.elapsedMilliseconds! >= 0);
    assert.ok(Number.isFinite(ply.actualElapsedMilliseconds) && ply.actualElapsedMilliseconds >= 0);
    if (ply.resultSource === 'fallback') {
      assert.equal(ply.completedDepth, 0);
      assert.equal(ply.timedOut, true);
      assert.equal(ply.selectedEvaluation, null);
      assert.equal(ply.evaluationBreakdown, null);
      assert.deepEqual(ply.principalVariation, []);
    } else assert.equal(ply.resultSource, 'completed-iteration');
    assert.ok(getLegalActions(state).some(action => areLegalActionsEqual(action, ply.action)));
    const next = executeLegalAction(state, ply.action, { proposer: 'local_ai' });
    assert.equal(next.type, 'applied');
    if (next.type === 'applied') state = next.state;
  }
  assert.equal(game.plies.length <= configRow.config.maxPlies, true);
  if (game.status === 'max_plies') {
    assert.equal(game.outcome, 'max_plies');
    assert.equal(game.plies.length, configRow.config.maxPlies);
  } else if (game.status === 'ended') {
    assert.equal(state.status, 'ended');
    assert.deepEqual(game.detail, state.result);
    const winner = state.result?.winner;
    assert.equal(game.outcome, winner === null ? 'draw' : game[winner!] === 'A' ? 'a_win' : 'b_win');
  } else assert.equal(game.outcome, 'failed');
}
const stored = rows.find(row => row.type === 'summary');
assert.ok(stored);
const { type: _type, elapsedMilliseconds: _elapsed, ...storedSummary } = stored;
assert.deepEqual(storedSummary, summarizeGames(games));
assert.equal(rows.at(-1)?.type, 'end');
console.log(`${resolve(path)}: ${games.length} games / ${games.reduce((n, g) => n + g.plies.length, 0)} legal moves / summary reproduced`);
