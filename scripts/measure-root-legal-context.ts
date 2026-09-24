import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { executeLegalAction, getLegalActions } from '../src/domain/shogi/legalActions';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, areLegalActionsEqual } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { createInitialBoardState } from '../src/types/shogi';
import { performance } from 'node:perf_hooks';
import { DEFAULT_CONFIG, type MeasurementGame } from './benchmarks/timedFallbackSelfPlay';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { ROOT_LEGAL_TARGETS } from './benchmarks/rootLegalTargets';

const output = process.argv[2];
assert.ok(output?.endsWith('.jsonl'), 'Usage: npm run measure:root-legal-context -- PATH.jsonl');
const out = resolve(output);
assert.ok(!existsSync(out) && !existsSync(out.slice(0, -6) + '.md'), 'output already exists');
mkdirSync(dirname(out), { recursive: true });
const { positions, sourceSha256 } = replayPositions(SOURCE, ROOT_LEGAL_TARGETS);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
const rows: object[] = [{ type: 'config', schema: 'root-legal-context-v1', startedAt: new Date().toISOString(),
  head, dirty: status !== '', node: process.version, os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model ?? 'unknown', config: DEFAULT_CONFIG, sourceSha256,
  execution: 'four saved games replayed in exact stored action order; protected timed search precedes each stored action; count-only root probe; no per-candidate clocks' }];
const observations: Array<{ type: 'sample'; positionKeySha256: string; callElapsedMilliseconds: number;
  completedDepth: number; resultSource: string; action: unknown; root: object | null }> = [];
const games = readFileSync(SOURCE, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  .filter(row => row.type === 'game') as MeasurementGame[];
const evaluation = resolveSearchEvaluationPreset('standard');
for (const game of games) {
  let state = createInitialBoardState();
  rows.push(game);
  for (const ply of game.plies) {
    assert.equal(ply.positionKey, createPositionKey(state));
    const input = protectSearchInput(state);
    const diagnostic = new SearchDiagnostics();
    const start = performance.now();
    const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, DEFAULT_CONFIG.maxDepth,
      DEFAULT_CONFIG.timeLimitMilliseconds, evaluation, performance.now.bind(performance),
      { moveOrdering: DEFAULT_CONFIG.moveOrdering, quiescence: {
        maxTacticalDepth: DEFAULT_CONFIG.maxTacticalDepth, moveOrdering: DEFAULT_CONFIG.quiescenceMoveOrdering } }, diagnostic);
    const end = performance.now();
    assert.equal(input.wasMutated(), false);
    const rootTotal = diagnostic.phases['root-legal'].maxMilliseconds ?? 0;
    const piece = diagnostic.phases['root-piece-moves'];
    const drop = diagnostic.phases['root-hand-drops'];
    const sample = { type: 'sample' as const, positionKeySha256: sha(createPositionKey(state)),
      callElapsedMilliseconds: end - start,
      completedDepth: result.completedDepth, resultSource: result.resultSource,
      action: result.selectedAction,
      root: { totalMilliseconds: rootTotal, pieceCalls: piece.calls, pieceMilliseconds: piece.milliseconds,
        pieceMaxMilliseconds: piece.maxMilliseconds ?? 0, dropCalls: drop.calls,
        dropMilliseconds: drop.milliseconds, dropMaxMilliseconds: drop.maxMilliseconds ?? 0,
        residualMilliseconds: rootTotal - piece.milliseconds - drop.milliseconds,
        byType: diagnostic.rootDrops } };
    observations.push(sample);
    assert.equal(sample.positionKeySha256, sha(ply.positionKey));
    const id = `g${game.executionIndex}-p${ply.ply}`;
    const original = positions.find(position => position.id === id);
    rows.push({ ...sample, id, gameIndex: game.executionIndex, ply: ply.ply,
      matchesSavedPosition: original ? sample.positionKeySha256 === original.positionKeySha256 : null });
    assert.ok(getLegalActions(state).some(action => areLegalActionsEqual(action, ply.action)));
    const applied = executeLegalAction(state, ply.action, { proposer: 'local_ai' });
    assert.equal(applied.type, 'applied');
    if (applied.type === 'applied') state = applied.state;
  }
}
const targets = rows.filter((row): row is typeof observations[number] & { id: string; matchesSavedPosition: boolean } =>
  typeof row === 'object' && row !== null && 'matchesSavedPosition' in row && row.matchesSavedPosition !== null);
rows.push({ type: 'end', endedAt: new Date().toISOString() });
writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
const lines = ['# 連続対局でのroot合法手生成', '',
  `コード ${head}、dirty=${status !== ''}、Node ${process.version}、${platform()} ${release()} ${arch()}、${cpus()[0]?.model ?? 'unknown'}。`,
  `設定 ${JSON.stringify(DEFAULT_CONFIG)}。保存棋譜4局を各手の保護入力探索後に元の着手で再生。診断ON・工程内の時計読みOFF。ウォームアップと反復なし。`,
  '局面一致は保存棋譜のpositionKeyハッシュで判定。最大は単一呼出し、合計は呼出しをまたぐ累積。',
  '', '| 局面 | 保存局面一致 | 呼出ms | 超過ms | root全体ms | 移動ms | 打ちms | 残余ms | 打ち単一最大ms | 深さ | 返却 |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'];
for (const target of targets) {
  const root = target.root as { totalMilliseconds: number; pieceMilliseconds: number; dropMilliseconds: number;
    residualMilliseconds: number; dropMaxMilliseconds: number };
  lines.push(`| ${target.id} | ${target.matchesSavedPosition} | ${target.callElapsedMilliseconds.toFixed(2)} | ${(target.callElapsedMilliseconds - 100).toFixed(2)} | ${root.totalMilliseconds.toFixed(2)} | ${root.pieceMilliseconds.toFixed(2)} | ${root.dropMilliseconds.toFixed(2)} | ${root.residualMilliseconds.toFixed(2)} | ${root.dropMaxMilliseconds.toFixed(2)} | ${target.completedDepth} | ${target.resultSource} |`);
}
lines.push('', `全再生サンプル${observations.length}件。保存局面との一致をpositionKeyで確認。探索が返した手では進めず元棋譜の手を適用したため、連続対局の探索配分と同一条件ではない。詳細と各駒種の件数・時間はJSONL。`);
writeFileSync(out.slice(0, -6) + '.md', lines.join('\n') + '\n', { flag: 'wx' });
console.log(`${out}: ${games.length} games, ${observations.length} samples, ${targets.length} target rows`);
