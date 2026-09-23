import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInitialBoardState } from '../src/types/shogi';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { DEFAULT_CONFIG, runMeasurement, summarizeGames, type MeasurementConfig, type MeasurementGame } from './benchmarks/timedFallbackSelfPlay';

function argumentsFromCli(argv: string[]): { output: string; config: MeasurementConfig } {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--out', '--pairs', '--max-plies', '--limit-ms', '--max-depth', '--q-depth'].includes(key) ||
      !argv[i + 1] || values[key] !== undefined) throw new Error(`Invalid or duplicate argument: ${key}`);
    values[key] = argv[i + 1];
  }
  if (!values['--out']) throw new Error('Usage: npm run measure:timed-fallback-self-play -- --out PATH [--pairs N] [--max-plies N] [--limit-ms N] [--max-depth N] [--q-depth N]');
  const number = (key: string, fallback: number, min: number) => {
    if (values[key] === undefined) return fallback;
    const n = Number(values[key]);
    if (!Number.isSafeInteger(n) || n < min) throw new Error(`${key} must be an integer >= ${min}`);
    return n;
  };
  return { output: resolve(values['--out']), config: {
    ...DEFAULT_CONFIG,
    pairCount: number('--pairs', DEFAULT_CONFIG.pairCount, 1),
    maxPlies: number('--max-plies', DEFAULT_CONFIG.maxPlies, 1),
    timeLimitMilliseconds: number('--limit-ms', DEFAULT_CONFIG.timeLimitMilliseconds, 0),
    maxDepth: number('--max-depth', DEFAULT_CONFIG.maxDepth, 1),
    maxTacticalDepth: number('--q-depth', DEFAULT_CONFIG.maxTacticalDepth, 0),
  } };
}

const format = (n: number | null) => n === null ? 'n/a' : Number.isInteger(n) ? String(n) : n.toFixed(2);

function markdown(summary: ReturnType<typeof summarizeGames>, config: MeasurementConfig, elapsed: number): string {
  const lines = [
    '# 時間制限付き探索フォールバック実対局測定',
    '',
    `条件: 平手固定、${config.pairCount}ペア${summary.totalGames}局、最大${config.maxPlies}手、各手${config.timeLimitMilliseconds}ms、最大深さ${config.maxDepth}、評価${config.evaluationPreset}、通常手順${config.moveOrdering}、静止追加${config.maxTacticalDepth}手／${config.quiescenceMoveOrdering}。`,
    `実行: 同期直列、奇数ペアはAB→BA、偶数ペアはBA→AB。全体実経過 ${format(elapsed)}ms。`,
    `結果: A勝${summary.outcomes.aWins}、B勝${summary.outcomes.bWins}、引分${summary.outcomes.draws}、最大手数打切${summary.outcomes.maxPlies}、失敗${summary.outcomes.failures}。合計${summary.totalPlies}着手。`,
    '',
    '| 参加者 | 着手 | fallback | 率 | 実時間超過 | 超過中央値ms | 超過最大ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const id of ['A', 'B'] as const) {
    const p = summary.participants[id] as ReturnType<typeof summarizeGames>['participants'][string];
    lines.push(`| ${id} | ${p.moves} | ${p.fallbackCount} | ${p.fallbackRate === null ? 'n/a' : (p.fallbackRate * 100).toFixed(1) + '%'} | ${p.actualOverLimit.count}/${p.moves} | ${format(p.actualOverLimit.medianExcessMilliseconds)} | ${format(p.actualOverLimit.maxExcessMilliseconds)} |`);
    lines.push(`${id} fallback手数: ${p.fallbackPlies.join(', ') || 'なし'}。深さ分布 ${JSON.stringify(p.completedDepthDistribution)}、手数帯 ${JSON.stringify(p.fallbackByPlyBand)}、超過分布 ${JSON.stringify(p.actualOverLimit.distribution)}。`);
  }
  lines.push('', `fallbackあり ${summary.byFallback.withFallback.games}局 ${JSON.stringify(summary.byFallback.withFallback.outcomes)}。fallbackなし ${summary.byFallback.withoutFallback.games}局 ${JSON.stringify(summary.byFallback.withoutFallback.outcomes)}。`, '',
    '| ペア/局 | 先手/後手 | 結果 | 手数 | A fallback/着手 | B fallback/着手 |',
    '| --- | --- | --- | ---: | ---: | ---: |');
  for (const game of summary.perGame) {
    const a = game.participants.A as ReturnType<typeof summarizeGames>['participants'][string];
    const b = game.participants.B as ReturnType<typeof summarizeGames>['participants'][string];
    lines.push(`| ${game.pairNumber}/${game.gameNumber} | ${game.sente}/${game.gote} | ${game.outcome} | ${game.plies} | ${a.fallbackCount}/${a.moves} | ${b.fallbackCount}/${b.moves} |`);
  }
  lines.push('', '同じ開始局面を反復するため独立標本ではありません。打切と失敗は勝敗・引分に含めません。少数対局から棋力差を判断しません。',
    '指定時間の一致だけでは公平な同一時間比較になりません。API内経過と呼び出し実経過を別々に記録し、超過率と分布を確認します。',
    '旧方式（PR #150以前）は100ms指定でも深さ1完走で大幅超過し得ます。旧方式の対局比較はこの測定に含めず、実経過時間を揃えた別課題とします。', '');
  return lines.join('\n');
}

let rawFd: number | undefined, reportFd: number | undefined;
try {
  const { output, config } = argumentsFromCli(process.argv.slice(2));
  const reportPath = output.replace(/\.jsonl$/i, '') + '.md';
  if (reportPath === output) throw new Error('--out must end in .jsonl');
  mkdirSync(dirname(output), { recursive: true });
  rawFd = openSync(output, 'wx');
  reportFd = openSync(reportPath, 'wx');
  const emit = (row: object) => writeSync(rawFd!, JSON.stringify(row, (_k, value: unknown) =>
    typeof value === 'number' && !Number.isFinite(value) ? String(value) : value) + '\n');
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const initialState = createInitialBoardState();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  emit({ type: 'config', startedAt, head, dirty: status !== '', status,
    node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
    execution: 'synchronous-serial-alternating-pair-order', config,
    initialPosition: config.initialPosition,
    initialPositionKeySha256: createHash('sha256').update(createPositionKey(initialState)).digest('hex'),
    initialPositionStateSha256: createHash('sha256').update(JSON.stringify(initialState)).digest('hex'),
    denominator: 'successfully applied legal moves; terminal no-action states do not count as fallback moves' });
  const games: MeasurementGame[] = runMeasurement(config, { initialState, onGame: emit });
  const summary = summarizeGames(games);
  const elapsedMilliseconds = performance.now() - started;
  emit({ type: 'summary', ...summary, elapsedMilliseconds });
  emit({ type: 'end', endedAt: new Date().toISOString(), elapsedMilliseconds });
  writeSync(reportFd, markdown(summary, config, elapsedMilliseconds), undefined, 'utf8');
  console.log(`JSONL: ${output}\n集計: ${reportPath}\n${summary.totalGames}局 / ${summary.totalPlies}着手 / ${elapsedMilliseconds.toFixed(0)}ms`);
  if (summary.outcomes.failures) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (rawFd !== undefined) closeSync(rawFd);
  if (reportFd !== undefined) closeSync(reportFd);
}
