import { cpus, platform, release, arch } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSelfPlayCli, selfPlayJson } from './benchmarks/quiescenceOrderingSelfPlay';

const startedAt = new Date().toISOString();
try {
  if (process.argv.length > 2) throw new Error('Usage: npm run measure:quiescence-ordering-self-play (fixed configuration; no arguments)');
  const sourceFiles = [
    'scripts/measure-quiescence-ordering-self-play.ts', 'scripts/benchmarks/quiescenceOrderingSelfPlay.ts',
    'scripts/benchmarks/quiescenceOrderingSuite.ts', 'src/types/shogi.ts',
    ...readdirSync('src/domain/shogi').filter(p => p.endsWith('.ts')).map(p => `src/domain/shogi/${p}`),
  ].sort();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  console.log('# 静止探索順 original/material 複数ペア実対局パイロット');
  console.log(`RUN ${selfPlayJson({ startedAt, node: process.version,
    npm: process.env.npm_config_user_agent ?? 'unknown', os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: status !== '', status, execution: 'synchronous-serial',
    command: 'npm run measure:quiescence-ordering-self-play',
    sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  })}`);
  process.exitCode = runSelfPlayCli();
} catch (error) {
  console.error(`ERROR ${selfPlayJson({ message: error instanceof Error ? error.message : String(error) })}`);
  process.exitCode = 1;
} finally {
  console.log(`END ${selfPlayJson({ startedAt, endedAt: new Date().toISOString(), exitCode: process.exitCode ?? 0 })}`);
}
