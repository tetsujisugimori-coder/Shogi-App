import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { median, TARGETS } from './benchmarks/postRootDepthOne';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';

const [timedPath, offPath, onPath, baselineTimedPath, baselineOffPath, reportPath] = process.argv.slice(2);
assert.ok(reportPath?.endsWith('.md'), 'Usage: npm run audit:action-revalidation -- TIMED OFF ON BASELINE_TIMED BASELINE_OFF REPORT.md');
const read = (path: string): any[] => readFileSync(path, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const series = [timedPath, offPath, onPath, baselineTimedPath, baselineOffPath].map(read);
const [timed, off, on, baselineTimed, baselineOff] = series;
const { sourceSha256, positions } = replayPositions(SOURCE, TARGETS);
const measurement = (rows: any[], id: string) => rows.filter(row => row.type === 'sample' && row.positionId === id && row.phase === 'measurement');
const semanticFields = ['selectedAction', 'selectedEvaluation', 'principalVariation', 'completedDepth',
  'rootLegalActionCount', 'visitedPositionCount', 'quiescenceVisitedPositionCount', 'fallback', 'timedOut'];
for (const [i, rows] of series.entries()) {
  assert.equal(rows[0].schema, 'action-revalidation-v1');
  assert.equal(rows[0].mode, ['timed', 'fixed-off', 'fixed-on', 'timed', 'fixed-off'][i]);
  assert.equal(rows[0].sourceSha256, sourceSha256);
  assert.equal(rows[0].source, SOURCE);
  assert.equal(rows[0].warmups, 2); assert.equal(rows[0].runs, 5);
  for (const field of ['settings', 'node', 'os', 'cpu']) assert.deepEqual(rows[0][field], timed[0][field]);
  assert.equal(rows.at(-1)?.type, 'end');
  assert.equal(rows.filter(row => row.type === 'sample').length, 28);
  assert.equal(rows.filter(row => row.type === 'position').length, 4);
  for (const position of positions) {
    const meta = rows.find(row => row.type === 'position' && row.id === position.id);
    assert.ok(meta);
    assert.equal(meta.stateSha256, position.stateSha256);
    assert.equal(meta.positionKeySha256, position.positionKeySha256);
    assert.equal(meta.historyLength, position.historyLength);
    assert.deepEqual(meta, timed.find(row => row.type === 'position' && row.id === position.id),
      `${position.id}: action contents/order and all root successor states`);
    const samples = rows.filter(row => row.type === 'sample' && row.positionId === position.id);
    assert.deepEqual(samples.map(row => [row.phase, row.run]),
      [['warmup', 1], ['warmup', 2], ...[1, 2, 3, 4, 5].map(run => ['measurement', run])]);
    for (const row of samples) {
      assert.equal(row.inputUnchanged, true);
      assert.ok(Number.isFinite(row.apiElapsedMilliseconds) && row.apiElapsedMilliseconds >= 0);
      assert.equal(row.rootLegalActionCount, meta.rootCandidates);
      if (rows[0].mode === 'timed') {
        assert.equal(row.fallback, row.completedDepth === 0);
        if (row.fallback) {
          assert.deepEqual(row.selectedAction, meta.actions[0]); assert.equal(row.selectedEvaluation, null);
        }
      } else {
        assert.equal(row.completedDepth, 1);
        const reference = off.find(x => x.type === 'sample' && x.positionId === position.id);
        for (const field of semanticFields) assert.deepEqual(row[field], reference[field], `${position.id}: ${field}`);
      }
      if (!row.diagnostics) continue;
      const d = row.diagnostics.actionValidation;
      for (const entry of Object.values(d) as any[]) for (const span of Object.values(entry) as any[]) {
        assert.ok(Number.isSafeInteger(span.calls) && span.calls >= 0);
        assert.ok(Number.isFinite(span.inclusiveMilliseconds) && span.inclusiveMilliseconds >= 0);
      }
      const executed = d.executionBoard['execute-action'].calls + d.executionDrop['execute-action'].calls;
      assert.equal(row.diagnostics.executeLegalAction.calls, executed);
      assert.equal(row.diagnostics.executeLegalAction.inclusiveMilliseconds,
        d.executionBoard['execute-action'].inclusiveMilliseconds + d.executionDrop['execute-action'].inclusiveMilliseconds);
      assert.equal(executed, row.visitedPositionCount + row.quiescenceVisitedPositionCount);
      const phases = row.diagnostics.phases;
      assert.equal(executed, phases['normal-execute'].calls + phases['q-execute'].calls);
      assert.equal(d.generationBoard['validation'].calls, d.generationBoard['own-check'].calls);
      assert.equal(d.generationBoard['validation'].calls, d.generationBoard['board-setup'].calls);
      for (const origin of ['executionBoard', 'executionDrop']) {
        const e = d[origin];
        for (const stage of ['execute-api', 'validation', 'board-setup', 'own-check'])
          assert.equal(e[stage].calls, e['execute-action'].calls, `${origin}.${stage}`);
        assert.ok(e.validation.inclusiveMilliseconds <= e['execute-api'].inclusiveMilliseconds + 1e-6);
        assert.ok(e['execute-api'].inclusiveMilliseconds <= e['execute-action'].inclusiveMilliseconds + 1e-6);
        assert.ok(e['board-setup'].inclusiveMilliseconds + e['own-check'].inclusiveMilliseconds +
          e['pawn-drop-mate'].inclusiveMilliseconds <= e.validation.inclusiveMilliseconds + 1e-6);
      }
      assert.ok(d.generationDrop['own-check'].calls <= d.generationDrop.validation.calls);
      assert.equal(d.generationDrop['board-setup'].calls, d.generationDrop['own-check'].calls);
      assert.ok(phases['q-board-own-check'].calls <= d.generationBoard['own-check'].calls);
      assert.ok(phases['q-drop-own-check'].calls <= d.generationDrop['own-check'].calls);
    }
  }
}
const f = (n: number | null) => n === null ? '—' : n.toFixed(2);
const config = on[0];
const first = positions.map(position => measurement(on, position.id)[0]);
const sumCalls = (origin: string, stage: string) => first.reduce((sum, row) =>
  sum + row.diagnostics.actionValidation[origin][stage].calls, 0);
const boardExecutions = sumCalls('executionBoard', 'execute-action');
const dropExecutions = sumCalls('executionDrop', 'execute-action');
const generationChecks = sumCalls('generationBoard', 'own-check') + sumCalls('generationDrop', 'own-check');
const revalidationTimes = positions.map(position => median(measurement(on, position.id).map(row =>
  row.diagnostics.actionValidation.executionBoard.validation.inclusiveMilliseconds +
  row.diagnostics.actionValidation.executionDrop.validation.inclusiveMilliseconds))!);
const revalidationRatios = positions.map(position => median(measurement(on, position.id).map(row => 100 *
  (row.diagnostics.actionValidation.executionBoard.validation.inclusiveMilliseconds +
    row.diagnostics.actionValidation.executionDrop.validation.inclusiveMilliseconds) / row.apiElapsedMilliseconds))!);
const lines = ['# 合法手生成後の実行時再検証診断', '',
  `基準main: \`${baselineOff[0].head}\`（PR #174）。診断計測HEAD: \`${config.head}\`、dirty=${config.dirty}。`,
  `保存棋譜: \`${SOURCE}\`。SHA-256: \`${sourceSha256}\`。`,
  `環境: ${config.os} / ${config.cpu} / Node ${config.node}。`,
  '条件: g1-p115、g3-p55、g4-p89、g1-p93。標準評価・標準手順序・静止探索追加1手（original）、最大深さ4・100ms通常探索、固定深さ1完走。各系列は独立プロセス、同期直列、4局面を各巡回、各2ウォームアップ＋本測定5回。',
  '生成（root・通常・静止）と実行（root・通常・静止）をすべて対象とする。新診断はSearchDiagnostics第4引数をtrueにした場合だけ有効。既存の細粒度checkInternalsはOFF。時計はSearchDiagnostics.beginへ渡したperformance時計を全段階で使用する。',
  '', '## 実コードの呼出経路', '',
  '`getLegalActions` / `getQuiescenceLegalActionsWithDiagnostics` → `getLegalMoves` → 擬似合法手列挙 → 候補ごとの局所盤面準備 → `isKingInCheck` → 成り選択列挙。生成側ではvalidateMoveは呼ばれない。generationBoard.validationは擬似候補1件の盤面準備＋自玉王手確認の包含、pseudo列挙時間は別欄。',
  '同じ生成API → `getLegalDropSquares` → 全81マスで`validateDrop` → 引数・駒・二歩等 → 局所盤面準備 → 自玉王手確認 → 直接王手の歩だけ打ち歩詰め確認。',
  '`executeLegalAction` → `executeMove` → `validateMove` → 擬似合法手再列挙 → 公開simulateMoveSquaresによる盤面全複製 → 自玉王手確認。成り検証はexecuteMove内の後続工程。',
  '`executeLegalAction` → `executeDrop` → `validateDrop` → 同じdrop検証・盤面準備・自玉王手・条件付き打ち歩詰め。公開APIの検証を維持し、内部適用経路は作成していない。',
  '', '## 固定深さ1：実行と再検証', '',
  '| 局面 | executed board | executed drop | execution validateMove | execution validateDrop | 再検証関連時間ms（中央値） | 再検証/API %（中央値） | completedDepth |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
for (const position of positions) {
  const rows = measurement(on, position.id);
  const d = rows[0].diagnostics.actionValidation;
  const revalidation = (row: any) => row.diagnostics.actionValidation.executionBoard.validation.inclusiveMilliseconds + row.diagnostics.actionValidation.executionDrop.validation.inclusiveMilliseconds;
  lines.push(`| ${position.id} | ${d.executionBoard['execute-action'].calls} | ${d.executionDrop['execute-action'].calls} | ${d.executionBoard.validation.calls} | ${d.executionDrop.validation.calls} | ${f(median(rows.map(revalidation)))} | ${f(median(rows.map(row => 100 * revalidation(row) / row.apiElapsedMilliseconds)))} | 1 |`);
}
lines.push('', 'board/dropとも execution validation / executed action = 1.00（drop実行0件は比率未定義）。上表の再検証時間はboard+drop validationの包含だけを足す。executeやown-checkの包含を重ねて足さない。時間は診断ON内の補助値で、通常探索や将来の削減率へ外挿しない。',
  '', '## 生成側と処理量', '',
  '| 局面 | root候補 | visited normal / q | generation board候補検証 | generation validateDrop | generation own-check board / drop | execution own-check board / drop |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const position of positions) {
  const rows = measurement(on, position.id); const row = rows[0]; const d = row.diagnostics.actionValidation;
  const counts = rows.map(x => Object.fromEntries(Object.entries(x.diagnostics.actionValidation).map(([origin, spans]) =>
    [origin, Object.fromEntries(Object.entries(spans as object).map(([stage, span]) => [stage, (span as any).calls]))])));
  for (const count of counts) assert.deepEqual(count, counts[0], `${position.id}: repeat counts`);
  lines.push(`| ${position.id} | ${row.rootLegalActionCount} | ${row.visitedPositionCount} / ${row.quiescenceVisitedPositionCount} | ${d.generationBoard.validation.calls} | ${d.generationDrop.validation.calls} | ${d.generationBoard['own-check'].calls} / ${d.generationDrop['own-check'].calls} | ${d.executionBoard['own-check'].calls} / ${d.executionDrop['own-check'].calls} |`);
}
lines.push('', 'own-check回数は対応するisKingInCheck呼出数。打ち歩詰め内部の相手玉確認・応手生成、実行後の終局・反復判定、探索q-checkはこの欄の対象外。実走査マスは今回計測しない。両側同じ合法性要件を再確認するが、boardの生成側は局所複製、実行側は全複製で、完全に同一処理ではない。',
  '', '| 局面 | 既存q-board-own-check | 既存q-drop-own-check | executeLegalAction総数 | 包含時間中央値ms |',
  '| --- | ---: | ---: | ---: | ---: |');
for (const position of positions) {
  const rows = measurement(on, position.id); const row = rows[0];
  lines.push(`| ${position.id} | ${row.diagnostics.phases['q-board-own-check'].calls} | ${row.diagnostics.phases['q-drop-own-check'].calls} | ${row.diagnostics.executeLegalAction.calls} | ${f(median(rows.map(x => x.diagnostics.executeLegalAction.inclusiveMilliseconds)))} |`);
}
lines.push('', '既存PR #172/#174の生成側q-own-check回数と一致し、今回のgeneration合計はroot生成分も含む。既存の細粒度王手内部資料との時間比較は行わない。',
  '', '## 包含段階（診断ON、各5本で回数一致・時間中央値）', '',
  '| 局面 | 呼出元 | 段階 | 回数 | 包含ms |', '| --- | --- | --- | ---: | ---: |');
for (const position of positions) {
  const rows = measurement(on, position.id);
  for (const origin of ['generationBoard', 'generationDrop', 'executionBoard', 'executionDrop']) {
    for (const stage of ['execute-action', 'execute-api', 'validation', 'pseudo', 'board-setup', 'own-check', 'pawn-drop-mate']) {
      const spans = rows.map(row => row.diagnostics.actionValidation[origin][stage]);
      lines.push(`| ${position.id} | ${origin} | ${stage} | ${spans[0].calls} | ${f(median(spans.map(x => x.inclusiveMilliseconds)))} |`);
    }
  }
}
lines.push('', 'executeLegalAction総数・包含時間はexecutionBoard.execute-action＋executionDrop.execute-action。同項目を分けて示す上表から総数を再現できる。生成dropのvalidationは早期棄却を含む全候補で、実行側の合法dropだけとは母集団が異なる。pawn-drop-mateはガードを通った実処理回数（歩打ち全件数ではない）。',
  '', '## 診断OFFの通常100ms探索', '',
  '| 局面 | main→変更後 API中央値ms | main→変更後 completedDepth（各本） | main→変更後 fallback | root候補 |',
  '| --- | ---: | --- | ---: | ---: |');
for (const position of positions) {
  const b = measurement(baselineTimed, position.id); const a = measurement(timed, position.id);
  for (const row of a) for (const before of b.filter(x => x.completedDepth === row.completedDepth))
    for (const field of semanticFields.filter(x => !['visitedPositionCount', 'quiescenceVisitedPositionCount'].includes(x)))
      assert.deepEqual(row[field], before[field], `${position.id}: timed ${field}`);
  lines.push(`| ${position.id} | ${f(median(b.map(x => x.apiElapsedMilliseconds)))} → ${f(median(a.map(x => x.apiElapsedMilliseconds)))} | ${b.map(x => x.completedDepth)} → ${a.map(x => x.completedDepth)} | ${b.filter(x => x.fallback).length}/5 → ${a.filter(x => x.fallback).length}/5 | ${a[0].rootLegalActionCount} |`);
}
lines.push('', '| 局面 | selectedAction | selectedEvaluation | timedOut（各本） |', '| --- | --- | --- | --- |');
for (const position of positions) {
  const a = measurement(timed, position.id);
  lines.push(`| ${position.id} | ${JSON.stringify(a[0].selectedAction)} | ${JSON.stringify(a[0].selectedEvaluation)} | ${a.map(x => x.timedOut)} |`);
}
lines.push('', '## 固定深さ1の独立OFF系列と監査', '',
  '| 局面 | main OFF中央値ms | 変更後 OFF中央値ms | 変更後 ON中央値ms |', '| --- | ---: | ---: | ---: |');
for (const position of positions) lines.push(`| ${position.id} | ${f(median(measurement(baselineOff, position.id).map(x => x.apiElapsedMilliseconds)))} | ${f(median(measurement(off, position.id).map(x => x.apiElapsedMilliseconds)))} | ${f(median(measurement(on, position.id).map(x => x.apiElapsedMilliseconds)))} |`);
lines.push('', '全4局面の合法手配列・順序・全root手の適用後state SHAをmain/OFF/ONで照合。timestampとランダムrecordIdだけ正規化し、盤面・持駒・手番・履歴・終局情報を含める。固定深さ1の全標本で選択手・評価・PV・完了深さ・通常/q訪問数が一致。各探索の入力は凍結Proxyによる書込み監視と前後SHAで非破壊確認。',
  '系列を交互に実行しない。JIT・GC・実行順やOS負荷の差を含むため、OFF/ON時間差を性能改善率に扱わない。100ms探索は制限時間付近で打ち切られるため、固定深さ1とは比較しない。',
  '', '## 仮説と結論', '',
  'A: 生成済みboard actionは実行ごとにvalidateMoveで幾何・自玉安全を再確認。B: 生成時にvalidateDrop済みのdropも実行ごとに再検証。C: 実行dropでは盤面準備・自玉王手判定が再実行され、条件付き打ち歩詰めも同経路を通る。実処理0回の項目は発生しなかった事実として扱う。',
  'Dは証明していない。処理回数と診断内の時間比から次PR優先度を判断し、検証を安全に省略できる範囲や通常探索での改善幅は別PRで設計・測定する。',
  `分類: **曖昧（重複は確実、主要な最適化対象と断定するには不足）**。board ${boardExecutions}件・drop ${dropExecutions}件の全${boardExecutions + dropExecutions}実行で再検証率1.00。生成側の直接own-checkは${generationChecks}回、実行側は${boardExecutions + dropExecutions}回（生成回数の${f(100 * (boardExecutions + dropExecutions) / generationChecks)}%）。診断ON内で再検証の包含中央値は局面ごと${f(Math.min(...revalidationTimes))}〜${f(Math.max(...revalidationTimes))}ms、API比${f(Math.min(...revalidationRatios))}〜${f(Math.max(...revalidationRatios))}%。処理量は存在するが、通常探索における費用対効果をこの時間比だけでA/B断定しない。`,
  `実行dropでは全${dropExecutions}件で盤面準備・自玉王手判定が発生し、打ち歩詰め処理は局面順に${first.map(row => row.diagnostics.actionValidation.executionDrop['pawn-drop-mate'].calls).join('/')}回（合計${sumCalls('executionDrop', 'pawn-drop-mate')}回）。Cは自玉確認について成立する。生成側の打ち歩詰めは${first.map(row => row.diagnostics.actionValidation.generationDrop['pawn-drop-mate'].calls).join('/')}回。静止探索でのdrop実行は合計${first.reduce((sum, row) => sum + row.diagnostics.actionValidation.executionDrop['execute-action'].calls - on.find(x => x.type === 'position' && x.id === row.positionId).actions.filter((x: any) => x.kind === 'drop').length, 0)}件。生成と探索実行の母集団の差が大きい。`,
  '次PR候補: 生成済みLegalAction専用の内部適用経路は検討対象に残すが、今回の数字だけで最優先とはしない。先にexecuteMove/executeDropの検証後の状態構築・履歴/反復・終局確認の残余、または静止探索で生成されたdropが未実行になる処理量を診断する。公開APIの安全性と内部経路の設計・高速化は別PR。このPRで検証省略・キャッシュは実装しない。',
  '', '再実行（各コマンドは別プロセス）:', '',
  '```powershell',
  'npm run measure:action-revalidation -- timed docs/benchmarks/別名-timed.jsonl',
  'npm run measure:action-revalidation -- fixed-off docs/benchmarks/別名-off.jsonl',
  'npm run measure:action-revalidation -- fixed-on docs/benchmarks/別名-on.jsonl',
  'npm run audit:action-revalidation -- TIMED OFF ON BASELINE_TIMED BASELINE_OFF REPORT.md', '```',
  '', 'baselineはmainの別worktreeへ同じ測定スクリプトのみコピーしtimed/fixed-offを実行。既存ファイルはwxで上書きしない。',
  `生データ: ${[timedPath, offPath, onPath, baselineTimedPath, baselineOffPath].map(x => `\`${x}\``).join('、')}。`, '');
writeFileSync(reportPath, lines.join('\n'), { flag: 'wx' });
console.log('Audited 5 independent series, 140 search samples, action order and successor states; report written.');
