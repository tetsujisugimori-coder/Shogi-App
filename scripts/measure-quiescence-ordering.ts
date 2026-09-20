// Observational A/B runs; elapsed time and completed depth are never CI thresholds.
import { cpus, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { formatOrderingCase, formatOrderingSummary, runOrderingSuite } from './benchmarks/quiescenceOrderingSuite';
import type { BenchmarkMode } from './benchmarks/quiescenceSuite';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['fixed', 'timed', 'both'].includes(args[0]))) {
    throw new Error('Usage: npm run measure:quiescence-ordering -- [fixed|timed|both]');
  }
  const modes: BenchmarkMode[] = !args.length || args[0] === 'both' ? ['fixed', 'timed'] : [args[0] as BenchmarkMode];
  console.log(`# 静止探索内順序付け A/B\n日時=${new Date().toISOString()}\nNode=${process.version}; npm=${process.env.npm_config_user_agent ?? 'unknown'}\nOS=${platform()} ${release()}; CPU=${cpus()[0]?.model ?? 'unknown'}\nHEAD=${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\nworking-tree=${execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim() || 'clean'}`);
  console.log('コマンド=npm run measure:quiescence-ordering; 固定深さ3 / 同一時間は最大深さ4・各設定独立1000ms。標準評価・通常standard順。');
  console.log('追加1手original→material→追加2手original→material。既存6局面・各1回・直列・ウォームアップなし。合法手集合・評価・戦術深さは同一、SEE不使用。');
  console.log('深さ1保証と協調的期限確認により時間は厳密な上限ではない。参考時間には未完了反復を含むが統計は完了反復のみ。PV再実行・評価内訳検証・表示の時間は含まない。');
  console.log('固定深さの評価不一致は失敗。環境・JIT・実行順に依存する参考値で、棋力や既定化の自動判定はしない。');
  const cases = runOrderingSuite(modes, {}, undefined, entry => console.log(formatOrderingCase(entry)));
  for (const mode of modes) console.log(formatOrderingSummary(cases, mode));
  if (cases.some(c => !c.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
