// Observational measurements only; never a CI timing threshold.
import { cpus, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { formatBenchmarkCase, formatBenchmarkSummary, parseBenchmarkModes, runBenchmarkSuite } from './benchmarks/quiescenceSuite';

try {
  const modes = parseBenchmarkModes(process.argv.slice(2));
  console.log(`# 静止探索の複数局面ベンチマーク\n日時=${new Date().toISOString()}\nNode=${process.version}; npm=${process.env.npm_config_user_agent ?? 'unknown'}\nOS=${platform()} ${release()}; CPU=${cpus()[0]?.model ?? 'unknown'}\nHEAD=${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}`);
  console.log('固定深さ3 / 同一時間は最大深さ4・各設定独立1000ms。標準評価・standard順。設定順は静止探索なし→追加1手→追加2手。各1回、直列、ウォームアップなし。');
  console.log('時間は深さ1保証と協調的期限確認により厳密な上限ではない。時間は未完了反復を含むが統計は完了反復のみ。検証・表示時間は含まない。');
  console.log('環境・JIT・実行順に依存する参考値。棋力判定・自動推奨・CI時間判定には使用しない。cutoff=カットオフ回数、skip=スキップ手数。');
  const cases = runBenchmarkSuite(modes, {}, undefined, entry => console.log(formatBenchmarkCase(entry)));
  for (const mode of modes) console.log(formatBenchmarkSummary(cases, mode));
  if (cases.some(entry => !entry.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
