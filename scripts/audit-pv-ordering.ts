import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeIterativeDeepeningAlphaBetaSearch as fixed } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { distancePositions, observePv, exhaustive, compareReference, apply } from './benchmarks/terminalDistanceReference';
import { json, parse, hash, byteHash } from './benchmarks/partialRootMatches';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { validatePartialRoot } from '../src/application/partialRootValidation';

const [mode, directory] = process.argv.slice(2);
const positions = distancePositions();
const settings = { moveOrdering: 'standard' as const, killerMoves: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
function stripTime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTime);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'elapsedMilliseconds').map(([key, v]) => [key, stripTime(v)])
  );
  return value;
}
if (mode === 'manifest') {
  const plan = parse(readFileSync(join(directory, 'run1/plan.json'), 'utf8'));
  const cpuPlan = parse(readFileSync(join(directory, 'cpu-run/plan.json'), 'utf8'));
  for (const file of ['src/domain/shogi/twoPlyAlphaBetaAi.ts', 'src/domain/shogi/searchValue.ts', 'src/domain/shogi/quiescenceSearch.ts']) {
    assert.equal(byteHash(readFileSync(file)), plan.sources[file]);
    assert.equal(plan.sources[file], cpuPlan.sources[file]);
  }
  assert.equal(byteHash(readFileSync(join(directory, 'run1/measurement-source.ts.txt'))), plan.sources['scripts/measure-pv-ordering.ts']);
  assert.equal(byteHash(readFileSync('scripts/measure-pv-ordering.ts')), cpuPlan.sources['scripts/measure-pv-ordering.ts']);
  execFileSync('git', ['diff', '--exit-code', plan.base, '--', 'docs/benchmarks/terminal-distance-20261020',
    'docs/benchmarks/terminal-distance-nan-20261021', 'docs/benchmarks/tactical-mate-20261019']);
  const out = join(directory, 'manifest.json');
  const collect = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = join(folder, entry.name);
    return entry.isDirectory() ? collect(file) : file === out ? [] : [file];
  });
  const files = ['README.md', 'LOG.md', 'scripts/audit-pv-ordering.ts', 'scripts/measure-pv-ordering.ts',
    'src/domain/shogi/twoPlyAlphaBetaAi.ts', 'src/test/shogi-previous-pv.test.ts', ...collect(directory)].sort();
  const data = { baseSha: plan.base, measuredWorktreeHead: plan.sha,
    note: 'Measured dirty implementation is identified by plan source hashes/diff, not HEAD alone. Final commit/CI SHA is recorded in the PR.',
    oldDiagnosticsUnchanged: true, measuredProductBytesMatchFinal: true,
    files: Object.fromEntries(files.map(file => [file.replaceAll('\\', '/'), byteHash(readFileSync(file))])) };
  try { assert.deepEqual(parse(readFileSync(out, 'utf8')), data); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    writeFileSync(out, json(data) + '\n', { flag: 'wx' });
  }
  console.log(`SHA-256 verified: ${files.length} files; old diagnostics unchanged; measured product bytes match final.`);
} else if (mode === 'deep-reference') {
  writeFileSync(directory, '', { flag: 'wx' });
  for (const id of ['mate-sente', 'mate-gote', 'mate-three', 'mixed-distance', 'terminal-resistance', 'terminal-resistance-gote']) {
    const p = positions.find(p => p.id === id)!;
    const startedAt = performance.now();
    const reference = exhaustive(p.state, 4, 1);
    for (const enabled of [false, true]) {
      const result = fixed(p.state, 4, undefined, undefined, { ...settings, usePreviousIterationPv: enabled });
      const observed = observePv(p.state, result.principalVariation);
      assert.equal(compareReference(observed, reference), 0, id);
      assert.deepEqual(result.selectedAction, reference.pv[0], 'original legal-index root tie');
      assert.deepEqual(result.evaluationBreakdown, observed.breakdown);
      appendFileSync(directory, json({ id, depth: 4, q: 1, enabled, reference, result, auditMs: performance.now() - startedAt }) + '\n');
    }
    console.log(id);
  }
} else if (mode === 'reference') {
  const out = resolve(directory);
  writeFileSync(out, '', { flag: 'wx' });
  const baseline = await import(pathToFileURL(resolve(process.argv[4], 'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
  for (const p of positions) {
    // An unchanged OFF path is compared to actual main, not just omitted vs false in the new binary.
    for (const depth of [1, 2, 3, 4]) {
      const before = baseline.analyzeIterativeDeepeningAlphaBetaSearch(p.state, depth, undefined, undefined, settings);
      const after = fixed(p.state, depth, undefined, undefined, { ...settings, usePreviousIterationPv: false });
      assert.deepEqual(stripTime(after), stripTime(before));
      appendFileSync(out, json({ kind: 'baseline-off', id: p.id, depth, result: after }) + '\n');
    }
    const conditions: [number, number | null][] = [[1, 0], [1, 1], [1, 2], [2, 1]];
    if (['mixed-distance', 'terminal-resistance', 'terminal-resistance-gote'].includes(p.id)) conditions.push([4, null], [4, 1], [3, 1]);
    for (const [depth, q] of conditions) {
      const reference = exhaustive(p.state, depth, q);
      const reverse = exhaustive(p.state, depth, q, p.state.turn, 0, true);
      assert.equal(compareReference(reference, reverse), 0);
      for (const enabled of [false, true]) {
        const before = hash(p.state);
        const result = fixed(p.state, depth, undefined, undefined, { ...settings, usePreviousIterationPv: enabled,
          quiescence: q === null ? undefined : { maxTacticalDepth: q } });
        const observed = observePv(p.state, result.principalVariation);
        assert.equal(compareReference(observed, reference), 0, `${p.id} d${depth} q${q} pv=${enabled}`);
        assert.deepEqual(result.evaluationBreakdown, observed.breakdown);
        assert.equal(result.selectedEvaluation, observed.breakdown.total);
        assert.equal(hash(p.state), before);
        // Verify root tie choice against original legal order, independently of interior PV ties.
        const candidates = getLegalActions(p.state).map(action => ({ action, leaf: exhaustive(apply(p.state, action), depth - 1, q, p.state.turn, 1) }));
        const winner = candidates.find(c => compareReference(c.leaf, reference) === 0);
        assert.deepEqual(result.selectedAction, winner?.action ?? null);
        appendFileSync(out, json({ kind: 'reference', id: p.id, depth, q, enabled, reference, reverse, result, candidates }) + '\n');
      }
    }
    console.log(p.id);
  }
} else if (mode === 'cpu-measurements') {
  const raw = readFileSync(join(directory, 'raw.jsonl'));
  const completed = parse(readFileSync(join(directory, 'completed.json'), 'utf8'));
  assert.equal(byteHash(raw), completed.rawSha256);
  const rows = raw.toString().trim().split('\n').map(parse);
  assert.equal(rows.length, 96); assert.equal(rows.length, completed.rows);
  const mainRows = readFileSync(join(process.argv[4], 'raw.jsonl'), 'utf8').trim().split('\n').map(parse);
  const mainPlan = parse(readFileSync(join(process.argv[4], 'plan.json'), 'utf8'));
  const cpuPlan = parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
  for (const source of ['twoPlyAlphaBetaAi', 'quiescenceSearch', 'searchValue']) {
    assert.equal(cpuPlan.sources[`src/domain/shogi/${source}.ts`], mainPlan.sources[`src/domain/shogi/${source}.ts`]);
  }
  assert.deepEqual(cpuPlan.settings, mainPlan.settings);
  assert.deepEqual(cpuPlan.positions, mainPlan.positions);
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    assert.equal(row.sequence, index); assert.equal(row.budget, null);
    const key = json([row.position,row.enabled,row.repeat]); assert.ok(!seen.has(key)); seen.add(key);
    assert.equal(row.enabled, index % 2 === 0 ? (index / 2) % 2 === 1 : !((Math.floor(index / 2)) % 2 === 1));
    assert.ok(row.cpuUserMs >= 0 && row.cpuSystemMs >= 0 && row.cpuTotalMs >= 0);
    assert.ok(Math.abs(row.cpuTotalMs - row.cpuUserMs - row.cpuSystemMs) < .000001);
    const previous = mainRows.find(other => other.position === row.position && other.enabled === row.enabled && other.budget === null)!;
    assert.deepEqual(stripTime(row.result), stripTime(previous.result));
  }
  const median = (values: number[]) => values.sort((a,b)=>a-b)[Math.ceil(values.length / 2) - 1];
  const data = positions.map(p => ({ id: p.id, variants: [false,true].map(enabled => {
    const group = rows.filter(r=>r.position===p.id && r.enabled===enabled && r.phase==='measurement');
    assert.equal(group.length,3);
    return { enabled, cpuP50: median(group.map(r=>r.cpuTotalMs)), cpuUserP50: median(group.map(r=>r.cpuUserMs)),
      cpuSystemP50: median(group.map(r=>r.cpuSystemMs)), wallP50: median(group.map(r=>r.callMs)),
      cpuSamples: group.map(r=>r.cpuTotalMs), wallSamples: group.map(r=>r.callMs) };
  }) }));
  const out = join(directory, 'summary.json');
  try { assert.deepEqual(parse(readFileSync(out, 'utf8')), data); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    writeFileSync(out, json(data) + '\n', { flag: 'wx' });
  }
  console.log(json(data));
} else if (mode === 'measurements') {
  const raw = readFileSync(join(directory, 'raw.jsonl'));
  const completed = parse(readFileSync(join(directory, 'completed.json'), 'utf8'));
  assert.equal(byteHash(raw), completed.rawSha256);
  const rows = raw.toString().trim().split('\n').map(parse);
  assert.equal(rows.length, 384); assert.equal(rows.length, completed.rows);
  const keys = new Set<string>();
  for (const [index, row] of rows.entries()) {
    assert.equal(row.sequence, index);
    const key = json([row.position, row.budget, row.repeat, row.enabled]); assert.ok(!keys.has(key)); keys.add(key);
    const s = positions.find(p => p.id === row.position)!.state, r = row.result;
    const fixedResult = rows.find(other => other.position === row.position && other.enabled === row.enabled && other.budget === null && other.repeat === 0)!.result;
    for (const iteration of r.iterations) {
      const pv = observePv(s, iteration.principalVariation);
      assert.deepEqual(iteration.evaluationBreakdown, pv.breakdown);
      assert.equal(iteration.selectedEvaluation, pv.breakdown.total);
      assert.deepEqual(iteration.selectedAction, iteration.principalVariation[0]);
      assert.deepEqual(stripTime(iteration), stripTime(fixedResult.iterations[iteration.depth - 1]), 'completed timed/fixed iteration is deterministic');
    }
    for (const field of ['VisitedPositionCount', 'CutoffCount', 'SkippedActionCount', 'QuiescenceLeafCount', 'QuiescenceVisitedPositionCount', 'QuiescenceCutoffCount', 'QuiescenceSkippedActionCount']) {
      const perIteration = field[0].toLowerCase() + field.slice(1);
      assert.equal(r['total' + field], r.iterations.reduce((sum: number, iteration: any) => sum + iteration[perIteration], 0));
    }
    const pv = observePv(s, r.principalVariation);
    assert.equal(row.reason, pv.reason); assert.equal(row.terminalDistancePly, pv.terminalDistancePly);
    if (r.resultSource === 'fallback') { assert.equal(r.selectedEvaluation, null); assert.equal(r.evaluationBreakdown, null); assert.equal(r.principalVariation.length, 0); }
    else { assert.deepEqual(r.evaluationBreakdown, pv.breakdown); assert.equal(r.selectedEvaluation, pv.breakdown.total); }
    if (r.resultSource === 'partial-root') {
      assert.ok(validatePartialRoot(s, r, 1));
      assert.equal(compareReference(pv, exhaustive(apply(s, r.selectedAction), 0, 1, s.turn, 1)), 0);
    }
    if (row.budget !== null) {
      assert.equal(r.completedDepth, r.iterations.length);
      if (r.completedDepth > 0) {
        assert.deepEqual(r.selectedAction, r.iterations[r.completedDepth - 1].selectedAction);
        assert.deepEqual(r.principalVariation, r.iterations[r.completedDepth - 1].principalVariation);
      }
    }
  }
  for (let index = 0; index < rows.length; index += 2) {
    const a = rows[index], b = rows[index + 1];
    assert.equal(a.enabled, (index / 2) % 2 === 1);
    assert.equal(b.enabled, !a.enabled);
    assert.equal(a.position, b.position); assert.equal(a.budget, b.budget); assert.equal(a.repeat, b.repeat);
  }
  const measured = rows.filter(r => r.phase === 'measurement');
  const percentile = (values: number[], p: number) => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  const summary = [100, 1000].flatMap(budget => [false, true].map(enabled => {
    const group = measured.filter(r => r.budget === budget && r.enabled === enabled);
    return { budget, enabled, n: group.length, p50: percentile(group.map(r => r.callMs), .5), p95: percentile(group.map(r => r.callMs), .95),
      maxOverrun: Math.max(...group.map(r => r.overrunMs)), overrunP50: percentile(group.map(r => r.overrunMs), .5), overrunP95: percentile(group.map(r => r.overrunMs), .95),
      visitedP50: percentile(group.map(r => r.result.visitedPositionCount), .5), qVisitedP50: percentile(group.map(r => r.result.quiescenceVisitedPositionCount), .5),
      totalVisitedP50: percentile(group.map(r => r.result.totalVisitedPositionCount), .5), totalQVisitedP50: percentile(group.map(r => r.result.totalQuiescenceVisitedPositionCount), .5),
      sources: Object.fromEntries(['completed-iteration', 'partial-root', 'fallback'].map(source => [source, group.filter(r => r.result.resultSource === source).length])),
      depths: Object.fromEntries([0, 1, 2, 3, 4].map(depth => [depth, group.filter(r => r.result.completedDepth === depth).length])),
      positions: positions.map(p => { const g = group.filter(r => r.position === p.id); return { id: p.id,
        p50: percentile(g.map(r => r.callMs), .5), p95: percentile(g.map(r => r.callMs), .95), maxOverrun: Math.max(...g.map(r => r.overrunMs)),
        depths: g.map(r => r.result.completedDepth), sources: g.map(r => r.result.resultSource) }; }) };
  }));
  const differences: unknown[] = [];
  const fixedRows = positions.map(p => {
    const off = measured.find(r => r.budget === null && !r.enabled && r.position === p.id)!;
    const on = measured.find(r => r.budget === null && r.enabled && r.position === p.id)!;
    for (let i = 0; i < 4; i++) {
      const a = off.result.iterations[i], b = on.result.iterations[i];
      assert.deepEqual(a.selectedAction, b.selectedAction, `${p.id} d${i + 1} root`);
      assert.equal(compareReference(observePv(p.state, a.principalVariation), observePv(p.state, b.principalVariation)), 0);
      if (json(a.principalVariation) !== json(b.principalVariation)) {
        let prefix = 0, state = p.state;
        while (json(a.principalVariation[prefix]) === json(b.principalVariation[prefix])) { state = apply(state, a.principalVariation[prefix++]); }
        assert.ok(prefix < i + 1, 'difference is in ordinary path');
        const candidates = [a, b].map(r => { const action = r.principalVariation[prefix];
          return { action, reference: exhaustive(apply(state, action), i - prefix, 1, p.state.turn, prefix + 1) }; });
        assert.equal(compareReference(candidates[0].reference, candidates[1].reference), 0, 'different PV continuations independently tie');
        differences.push({ id: p.id, depth: i + 1, prefix, offPv: a.principalVariation, onPv: b.principalVariation, candidates, conclusion: 'equal independent minimax continuation; interior first-visited tie changes with ordering' });
      }
    }
    return { id: p.id, off: off.result, on: on.result, timings: [false, true].map(enabled => ({ enabled,
      p50: percentile(measured.filter(r => r.position === p.id && r.budget === null && r.enabled === enabled).map(r => r.callMs), .5) })) };
  });
  const data = { rows: rows.length, measured: measured.length, summary, fixed: fixedRows, pvDifferences: differences };
  const out = join(directory, 'summary.json');
  try { assert.deepEqual(parse(readFileSync(out, 'utf8')), data); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    writeFileSync(out, json(data) + '\n', { flag: 'wx' });
  }
  const fmt = (value: number) => Number.isFinite(value) ? value.toFixed(3) : value === Infinity ? '+∞' : '−∞';
  const pair = (a: number, b: number) => `${a} / ${b}`;
  const report = ['# PV優先OFF / ONの生成集計', '',
    '通常/q統計は完了反復のみ。実時間は中断反復を含む。p50/p95はnearest-rank。固定時間は各条件3本、時間制限は各局面5本。', '',
    '| 局面 | d4通常 | d4静止 | 全反復通常 | 全反復静止 | d4 cutoff | d4 skipped | 実時間p50 ms | 評価 | 終局理由/距離 OFF→ON |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...fixedRows.map(f => { const a = f.off, b = f.on; return `| ${f.id} | ${pair(a.visitedPositionCount,b.visitedPositionCount)} | ${pair(a.quiescenceVisitedPositionCount,b.quiescenceVisitedPositionCount)} | ${pair(a.totalVisitedPositionCount,b.totalVisitedPositionCount)} | ${pair(a.totalQuiescenceVisitedPositionCount,b.totalQuiescenceVisitedPositionCount)} | ${pair(a.cutoffCount,b.cutoffCount)} | ${pair(a.skippedActionCount,b.skippedActionCount)} | ${fmt(f.timings[0].p50)} / ${fmt(f.timings[1].p50)} | ${fmt(a.selectedEvaluation)} | ${observePv(positions.find(p=>p.id===f.id)!.state,a.principalVariation).reason ?? '非終局'} / ${observePv(positions.find(p=>p.id===f.id)!.state,a.principalVariation).terminalDistancePly ?? '—'} → ${observePv(positions.find(p=>p.id===f.id)!.state,b.principalVariation).reason ?? '非終局'} / ${observePv(positions.find(p=>p.id===f.id)!.state,b.principalVariation).terminalDistancePly ?? '—'} |`; }), '',
    '| 予算ms | PV | n | 実時間p50/p95 ms | 超過p50/p95 ms | 最大超過ms | completed/partial/fallback | 深さ0/1/2/3/4 |',
    '|---:|---|---:|---:|---:|---:|---|---|',
    ...summary.map(s => `| ${s.budget} | ${s.enabled?'ON':'OFF'} | ${s.n} | ${fmt(s.p50)} / ${fmt(s.p95)} | ${fmt(s.overrunP50)} / ${fmt(s.overrunP95)} | ${fmt(s.maxOverrun)} | ${Object.values(s.sources).join(' / ')} | ${Object.values(s.depths).join(' / ')} |`), '',
    '| 予算ms | 局面 | 完了深さ OFF（反復順） | ON | 実時間p50 OFF/ON ms | 最大超過 OFF/ON ms |',
    '|---:|---|---|---|---:|---:|',
    ...[100,1000].flatMap(budget => positions.map(p => { const a = summary.find(s=>s.budget===budget&&!s.enabled)!.positions.find(g=>g.id===p.id)!;
      const b = summary.find(s=>s.budget===budget&&s.enabled)!.positions.find(g=>g.id===p.id)!;
      return `| ${budget} | ${p.id} | ${a.depths.join(',')} | ${b.depths.join(',')} | ${fmt(a.p50)} / ${fmt(b.p50)} | ${fmt(a.maxOverrun)} / ${fmt(b.maxOverrun)} |`; })), '',
    `内部PVが異なる深さ/局面: ${differences.length}件。個別の独立候補参照と判定はsummary.jsonのpvDifferences。`, ''].join('\n');
  const reportPath = join(directory, 'summary.md');
  try { assert.equal(readFileSync(reportPath, 'utf8'), report); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    writeFileSync(reportPath, report, { flag: 'wx' });
  }
  console.log(json(summary));
} else throw Error('reference <new-output.jsonl> <baseline-root> | deep-reference <new-output.jsonl> | measurements <run-directory> | cpu-measurements <cpu-run-directory> <main-run-directory> | manifest <evidence-directory>');
