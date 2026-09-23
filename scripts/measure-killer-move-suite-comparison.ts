import { arch, cpus, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rawJson } from './benchmarks/quiescenceOrderingRepeated';
import { runKillerMoveSuiteComparisonCli } from './benchmarks/quiescenceOrderingSuiteComparison';

const startedAt = new Date().toISOString();
try {
  const sourceFiles = [
    'scripts/measure-killer-move-suite-comparison.ts',
    'scripts/benchmarks/quiescenceOrderingSuiteComparison.ts',
    'scripts/benchmarks/quiescenceOrderingSuite.ts',
    'src/domain/shogi/twoPlyAlphaBetaAi.ts',
    'scripts/benchmarks/quiescenceOrderingSelfPlayScenarios.ts',
  ];
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  console.log(`RUN ${rawJson({ startedAt, node: process.version, npm: process.env.npm_config_user_agent ?? 'unknown',
    os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: status !== '', status,
    command: 'npm run measure:killer-move-suite-comparison -- [fixed|timed] [--time-limit-ms <positive integer>] [--max-depth <integer >= 1>]',
    sourceSha256: Object.fromEntries(sourceFiles.map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  })}`);
  process.exitCode = runKillerMoveSuiteComparisonCli(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  console.log(`END ${rawJson({ startedAt, endedAt: new Date().toISOString(), exitCode: process.exitCode ?? 0 })}`);
}
