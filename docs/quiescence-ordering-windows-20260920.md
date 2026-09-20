# PR #123 Windows同条件再検証（2026-09-20）

## 結論

共通8ファイル・独立した依存インストール・同じ2ワーカー設定で、main→PR→PR→main→main→PRの6回を直列実行した。**PR固有の性能回帰を示す結果は得られなかった。** 深さ3の詰み枝テストは両ディレクトリの初回だけ約5.3秒で5000msを超え、コード変更なしの後続2回ずつは約2.0〜2.6秒で成功した。もう一方のbenchmarkテストは6回すべて成功した。

分類は「mainにも存在する重い参照探索テストの、Windowsでの初回実行負荷・実行条件への依存」。観測できた発生範囲は独立npm ci後の各ディレクトリ初回であり、特定のOS処理、JIT、キャッシュ、ウイルス対策などを原因と断定する計測は行っていない。標本は各3回で、将来の時間超過がなくなる保証ではない。以前のbenchmarkの7.3秒/5.4秒は今回は再現せず、その過去の正確な負荷源は不明である。

本体・テスト・fixture・タイムアウト・Vitest設定・依存関係は変更しなかった。PRだけを高速化する根拠がなく、mainも繰り返し閾値付近だったわけではないため、局所的なタイムアウト延長も採用しない。READMEは仕様変更がないため更新しない。

## 比較条件

- 2026-09-20 21:23 JST開始。ブランチ `feat/quiescence-lightweight-ordering`、作業ツリーはクリーン。
- fetch後のPR HEAD / origin作業ブランチ / ローカルHEAD: `2f9f1920d40445a1e796aeb87526d04d5a9d5e84`。
- fetch後のorigin/main: `032622f4f23f90198681d745ff71c2ea5ca0261e`。
- Windows 11 Home / 10.0.26200、Intel Core i7-14650HX（24論理CPU）、Node v24.20.0、npm11.17.0。両側で同一のNode実行ファイルを使用。
- 親ディレクトリとリポジトリ内に追加AGENTS.mdなし。ユーザー提示の日時指示に従う。
- 新しいmain用detached worktree: `<MAIN_WORKTREE>`。既存のjunction共有worktreeやその他のユーザー作業は変更しない。
- PR側の `npm ci` は302 packages / 45秒、main側は302 packages / 35秒、両方終了0。直列実行。`node_modules`は別の実ディレクトリで、両方ともsymlink/junctionではない。Vitestもそれぞれの配下から起動。
- package-lock SHA-256は両方 `5e8430b71c59da6d0bf9018c0c2910312da375a97ff194b2e332903844c97c57`。インストール済み `node_modules/.package-lock.json` も両方 `a9f1deb316eb3cd4647d76519f111403dd507d47e97ab102b80fe13a66221ed8`。dependencies/devDependenciesも一致。
- 既存共通8テスト・setup.ts・vite.config.ts・package-lock.jsonはmainとPRで差分なし。

PR側を `<PROJECT_ROOT>`、main側を `<MAIN_WORKTREE>` と表す。前回の集中10ファイルコマンドはタスクのtool-call履歴から復元し、LOGと保存出力の件数で照合した。mainにない新規2ファイルはコピーせず、共通8ファイルを比較した。一覧と再実行コマンドは後述。

比較6回だけ、元のvite.configを継承する同一の一時configでファイル投入順、`maxWorkers: 2`、`fileParallelism: true`を固定した。testTimeoutは5000ms、テスト本文・各ファイル内順序・環境・setup・isolationは維持。既定sequencerの過去の失敗・実行時間キャッシュによる並べ替えを避けた。2ワーカー内部の完了順・重なりはOSのスケジューリングに依存する。

main→PR→PR→main→main→PRを直列実行し、各プロセス終了後に次を開始した。別のVitest・benchmark・build・E2Eは起動せず、ユーザーの常駐プロセスは停止していない。予定6回を成功するまで追加実行することはしていない。比較後、一時configは保存コピーとのハッシュ一致を確認して削除し、通常検証は標準configで実行した。

## mainとPR各3回の結果

対象テストの時間はVitest JSON reporterの各assertion.duration（ms）。合計時間は別途runnerが測ったプロセス全体であり、テストの時間と混同しない。

| 順 | 対象 | 終了 | 成功 / 失敗 | benchmark入力不変性 ms | 深さ3詰み枝 ms | プロセス全体 ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | main 1回目 | 1 | 290 / 1 | 700.825 | 5348.428（timeout） | 26930 |
| 2 | PR 1回目 | 1 | 290 / 1 | 724.150 | 5323.100（timeout） | 25875 |
| 3 | PR 2回目 | 0 | 291 / 0 | 789.746 | 2444.595 | 11137 |
| 4 | main 2回目 | 0 | 291 / 0 | 710.665 | 2628.232 | 11051 |
| 5 | main 3回目 | 0 | 291 / 0 | 778.486 | 1967.315 | 10931 |
| 6 | PR 3回目 | 0 | 291 / 0 | 1355.306 | 2157.918 | 10843 |

対象は `quiescence-benchmark.test.ts` の「持ち駒・棋譜・局面履歴のある入力を両モードで保持する」と、`shogi-two-ply-minimax-ai.test.ts` の「深さ3の途中で詰みへ到達した枝は、それ以上の子局面を生成せず既存の終局評価を返す」。

失敗は既存の5000ms時間超過だけで、値・推奨手・PV等のassertion不一致は報告されていない。問題の詰み枝テストは静止探索を指定せず、枝刈りなしの参照minimaxで深さ3の全合法枝を探索し、通常αβと比較する既存の重い統合テスト。PRのmaterial順序付けを呼ぶテストではない。両側の初回だけ同程度に遅いことから、PR固有の順序付けや材料表解決の性能回帰として本体を修正する証拠はない。

## 最終検証結果

比較後の追加検証は既定のsequencer・2ワーカー・5000msのままで直列実行。検証時に保存した終了要約・終了コードを以下へ集約した。これらの実行時間をCIの期待値にはしていない。

| コマンド | 終了 | 結果 |
| --- | ---: | --- |
| PR側 / main側 `npm ci` | 0 / 0 | 各302 packages、独立install |
| `npm run verify:lock` | 0 | 399 entries、registry398、欠落0 |
| `npm run lint` | 0 | 型エラー0 |
| `npx vitest run src/test/quiescence-benchmark.test.ts --reporter=verbose` | 0 | 38成功、0失敗 |
| `npx vitest run src/test/shogi-two-ply-minimax-ai.test.ts --reporter=verbose` | 0 | 69成功、0失敗。対象テスト1837ms |
| `npx vitest run`（新規2ファイル、verbose） | 0 | 41成功、0失敗 |
| `npx vitest run`（復元した10ファイル、verbose） | 0 | 332成功、0失敗。10.67秒 |
| `npm run measure:quiescence-ordering -- fixed` | 0 | 24条件成功、0失敗 |
| `npm run measure:quiescence-ordering -- timed` | 0 | 24条件成功、0失敗 |
| `npm run measure:quiescence-suite` | 0 | 36条件成功、0失敗 |
| `npm run check` | 0 | lock→lint→51ファイル1524テスト成功/0失敗（153.33秒）→build 1752 modules（2.07秒）まで完走 |
| `git diff --check` / `git diff --cached --check` | 0 / 0 | 追加証跡も含めて空白エラーなし |

`npm run check`は2026-09-20 21:36:10〜21:38:58 JSTに実行し、通常のUI・Worker・評価プリセット・SEEを含む全スイートの終了要約と終了コード0を取得した。既存jsdomの「Not implemented: navigation to another Document」通知は出たが、失敗は0。この結果を単独検証から推定していない。

fixedの12ペアでoriginal/materialの評価が一致し、推奨手・PVの合法性・末端評価内訳・入力不変性の検証に成功した。静止訪問948→712 / 681→472、カット1042→1102 / 714→546は前回と同じ。参考時間合計は883.2→802.6ms / 563.1→1358.0msへ変動した。金打ち合駒の追加2手materialが983.4msとなり、original130.2msより遅かったことも省略していない。

timedは完了反復だけを結果・統計へ採用する検証に成功。今回、初期局面の追加2手はoriginal深さ3 / material深さ2となった。他は両モードで深さ3/3/4/4/2（初期局面以外）。追加1手は初期局面を含めて両モード3/3/3/4/4/2。同一時間の異なる完了深さによる評価/PV差は正しさの失敗とは扱わず、検証時の生出力で全件を確認した。依然としてmaterialの既定化は推奨しない。

GitHub Actions [CI run #168](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/35510024792) は比較時のPR HEAD、[CI run #169](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/35511360040) は証跡追加後の `e2b63ae621cdfcd14a6f263cae64a414ed93910b` で、macOS・Ubuntuともlock・型チェック・全テスト・build成功。Windows同条件比較で発生範囲を確認し、通常設定の全体check・新旧ベンチマークとCIが成功したためReady for reviewへ移した。Windows成功をCIから推定していない。

## 再実行コマンド

両rootで同一Node/npmを使い、それぞれ独立して `npm ci` を直列実行する。共通8ファイルは次のPowerShell配列の順。新規2ファイルを先頭に追加した `$focused` が復元した元の集中10ファイル構成である。

```powershell
$common = @(
  'src/test/shogi-quiescence-search.test.ts'
  'src/test/shogi-two-ply-minimax-ai.test.ts'
  'src/test/shogi-see-move-ordering.test.ts'
  'src/test/shogi-move-ordering-modes.test.ts'
  'src/test/shogi-static-exchange-evaluation.test.ts'
  'src/test/quiescence-benchmark.test.ts'
  'src/test/shogi-quiescence-comparison.test.ts'
  'src/test/shogi-time-limited-quiescence-comparison.test.ts'
)
$focused = @(
  'src/test/shogi-quiescence-ordering.test.ts'
  'src/test/quiescence-ordering-benchmark.test.ts'
) + $common
```

両rootへ同じ一時ファイル `.pr123-windows.config.ts` を置く（既存ファイルがあれば上書きしない）。比較時に用いた内容:

```typescript
import base from './vite.config';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
const order = [
  'shogi-quiescence-ordering.test.ts', 'quiescence-ordering-benchmark.test.ts',
  'shogi-quiescence-search.test.ts', 'shogi-two-ply-minimax-ai.test.ts',
  'shogi-see-move-ordering.test.ts', 'shogi-move-ordering-modes.test.ts',
  'shogi-static-exchange-evaluation.test.ts', 'quiescence-benchmark.test.ts',
  'shogi-quiescence-comparison.test.ts', 'shogi-time-limited-quiescence-comparison.test.ts',
];
class ComparisonSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    const rank = (file: TestSpecification) => order.indexOf(file.moduleId.replaceAll('\\', '/').split('/').at(-1)!);
    if (files.some(file => rank(file) < 0)) throw new Error('Unexpected comparison file');
    const sorted = [...files].sort((a, b) => rank(a) - rank(b));
    console.log('[comparison-file-order]', JSON.stringify(sorted.map(f => f.moduleId.split('/').at(-1))));
    return sorted;
  }
}
export default defineConfig(async env => {
  const config = typeof base === 'function' ? await base(env) : await base;
  return { ...config, test: { ...config.test, maxWorkers: 2, fileParallelism: true, sequence: { sequencer: ComparisonSequencer } } };
});
```

各rootをカレントディレクトリにし、main→PR→PR→main→main→PRの順で次を1回ずつ実行する。コマンド・終了コード・verbose出力・JSONを各回別のファイルへ保存する。出力パスの `<RUN_OUTPUT>` はリポジトリ外の保存先へ置き換える。変更するのはcwdと出力先だけ。

```powershell
node node_modules/vitest/vitest.mjs run @common --config .pr123-windows.config.ts --reporter=verbose --reporter=json --outputFile.json="<RUN_OUTPUT>"
$LASTEXITCODE
```

比較後は自身が作成した一時configのみを除去し、PR側で通常設定の集中10ファイルを検証する。前回の正確なコマンドは `npx vitest run` に `$focused` の10引数を指定したもの。再検証ではverbose reporterも指定した。

```powershell
npx vitest run @focused --reporter=verbose
$LASTEXITCODE
```

各呼び出しは直列とし、別の重い検証は並行させない。最終品質ゲートとベンチマークのコマンドは上表を参照。

## 残る注意点

- Windowsの各初回のみ時間超過した観測範囲に限る。特定のOS処理、JIT、キャッシュ、ウイルス対策等の原因は未計測。以前のbenchmarkの7.3秒/5.4秒は再現せず、正確な負荷源は不明。将来の5000ms超過を防ぐ保証はない。
- 実時間は環境依存でCIの固定期待値にしない。materialは局面によって遅く、timedで完了深さも下がった。既定化を推奨せずoriginalを維持する。
- 調査時のGet-CimInstanceはアクセス拒否、rgのパス指定2回はos error123、Nodeからのgit呼び出しはsandboxのspawn EPERMで終了1。読取経路・パス指定を修正して確認した。テストのロジック失敗とは区別する。
- 生出力は検証時に使用したが、2026-09-21の文書整理で重複・再生成可能な38ファイルを最終ツリーから除外した。Windows結果・初回失敗・再現条件は本書と[LOG](../LOG.md)に残し、初回の失敗生出力は[既存記録](quiescence-ordering-validation-output.txt)を保持する。端末固有パスのみプレースホルダーへ置換した。
- リポジトリ外の元証跡と既存worktreeは保持した。ソース・テスト・fixture・設定・依存関係の修正や履歴書き換えは行わず、PR #123をReady for reviewのまま維持する。mainへのマージは行わない。
