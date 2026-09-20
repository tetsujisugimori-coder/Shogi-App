import { cpus, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseRepeatedModes, runRepeatedCli } from './benchmarks/quiescenceOrderingRepeated';

try {
  const args = process.argv.slice(2);
  parseRepeatedModes(args);
  console.log(`# 静止探索内順序付け repeated A/B\n開始日時=${new Date().toISOString()}\nNode=${process.version}; npm=${process.env.npm_config_user_agent ?? 'unknown'}\nOS=${platform()} ${release()}; CPU=${cpus()[0]?.model ?? 'unknown'}\nHEAD=${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}\nworking-tree=${execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim() || 'clean'}`);
  console.log(`コマンド=npm run measure:quiescence-ordering-repeated -- ${args[0] ?? 'both'}`);
  for (const path of ['scripts/measure-quiescence-ordering-repeated.ts', 'scripts/benchmarks/quiescenceOrderingRepeated.ts',
    'scripts/benchmarks/quiescenceOrderingSuite.ts', 'scripts/benchmarks/quiescencePositions.ts']) {
    console.log(`source-sha256 ${path}=${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
  }
  console.log('既存6局面、標準評価、通常standard、追加戦術深さ1/2、静止順original/material。fixed深さ3、timed最大4・各API呼出し独立1000ms。直列実行。');
  console.log('各比較条件warmup=3、measurement=8。phaseごと試行順を交代し本測定は4/4先行。開始は(局面index+追加深さ-1+試行index)%2、0ならoriginal先行。');
  console.log('API参考時間はAPI呼出し全体（未完了反復を含む）、凍結複製・検証・表示は除外。統計は完了反復のみ。全warmupも入力・PV・内訳検証。');
  console.log('SUMMARYは本測定のみ、外れ値除外なし。四分位数は昇順h=(n-1)*pの線形補間(type7)。IQR=Q3-Q1。増減率=(material中央値/original中央値-1)*100、original=0はnull。');
  console.log('changesFromFirstは各モード最初の本測定と異なる件数、pairedは同じ試行番号のoriginal対material。deepest/completedTotalsは各カウンタの8回分の分布統計。');
  console.log('Infinity/-Infinity/NaNは生JSONでは文字列保存。INCOMPLETEは集計なし、取得済みTRIALは残す。時間・深さは環境依存で、棋力・最適設定・material既定化を判定しない。CI性能ゲートにはしない。');
  process.exitCode = runRepeatedCli(args);
  console.log(`終了日時=${new Date().toISOString()}; exitCode=${process.exitCode}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
