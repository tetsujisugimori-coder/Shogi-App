# PR #123 Windows同条件再検証（2026-09-20）

## 結論と判定範囲

共通8ファイル・独立した依存インストール・同じ2ワーカー設定で、main→PR→PR→main→main→PRの6回を直列実行した。**PR固有の性能回帰を示す結果は得られなかった。** 深さ3の詰み枝テストは両ディレクトリの初回だけ約5.3秒で5000msを超え、コード変更なしの後続2回ずつは約2.0〜2.6秒で成功した。もう一方のbenchmarkテストは6回すべて成功した。

分類は「mainにも存在する重い参照探索テストの、Windowsでの初回実行負荷・実行条件への依存」。観測できた発生範囲は独立npm ci後の各ディレクトリ初回であり、特定のOS処理、JIT、キャッシュ、ウイルス対策などを原因と断定する計測は行っていない。標本は各3回で、将来の時間超過がなくなる保証ではない。以前のbenchmarkの7.3秒/5.4秒は今回は再現せず、その過去の正確な負荷源は不明である。

本体・テスト・fixture・タイムアウト・Vitest設定・依存関係は変更しなかった。PRだけを高速化する根拠がなく、mainも繰り返し閾値付近だったわけではないため、局所的なタイムアウト延長も採用しない。READMEは仕様変更がないため更新しない。

## 開始状態と環境

- 2026-09-20 21:23 JST開始。ブランチ `feat/quiescence-lightweight-ordering`、作業ツリーはクリーン。
- fetch後のPR HEAD / origin作業ブランチ / ローカルHEAD: `2f9f1920d40445a1e796aeb87526d04d5a9d5e84`。
- fetch後のorigin/main: `032622f4f23f90198681d745ff71c2ea5ca0261e`。
- Windows 11 Home / 10.0.26200、Intel Core i7-14650HX（24論理CPU）、Node v24.20.0、npm11.17.0。両側とも `C:/Program Files/nodejs/node.exe`。
- 親ディレクトリとリポジトリ内に追加AGENTS.mdなし。ユーザー提示の日時指示に従う。
- 新しいmain用detached worktree: `C:/Users/tetsu/Documents/Codex/shogi-pr123-windows-main-20260920`。既存のjunction共有worktreeやその他のユーザー作業は変更しない。
- PR側の `npm ci` は302 packages / 45秒、main側は302 packages / 35秒、両方終了0。直列実行。`node_modules`は別の実ディレクトリで、両方ともsymlink/junctionではない。Vitestもそれぞれの配下から起動。
- package-lock SHA-256は両方 `5e8430b71c59da6d0bf9018c0c2910312da375a97ff194b2e332903844c97c57`。インストール済み `node_modules/.package-lock.json` も両方 `a9f1deb316eb3cd4647d76519f111403dd507d47e97ab102b80fe13a66221ed8`。dependencies/devDependenciesも一致。
- 既存共通8テスト・setup.ts・vite.config.ts・package-lock.jsonはmainとPRで差分なし。

GitHub Actions [CI run #168](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/35510024792) のHEADは上記PR HEAD。macOS/Ubuntuそれぞれのlock検証・型チェック・全テスト・buildの成功をGitHub APIで確認し、[JSON](quiescence-ordering-windows-20260920/ci-run-168.json)へ保存した。Windows検証の代用にはしていない。

## 正確なコマンドと比較条件

前回の正確な10ファイルコマンドはこのCodexタスクのtool-call履歴から復元し、LOG.mdおよび保存済みfocused-tests/focused-rerunの件数と照合した。[復元コマンド](quiescence-ordering-windows-20260920/recovered-command.txt)。新規2ファイルはmainに存在せず、コピーせずに共通8ファイル比較を行った。

共通ファイルの引数順:

1. `src/test/shogi-quiescence-search.test.ts`
2. `src/test/shogi-two-ply-minimax-ai.test.ts`
3. `src/test/shogi-see-move-ordering.test.ts`
4. `src/test/shogi-move-ordering-modes.test.ts`
5. `src/test/shogi-static-exchange-evaluation.test.ts`
6. `src/test/quiescence-benchmark.test.ts`
7. `src/test/shogi-quiescence-comparison.test.ts`
8. `src/test/shogi-time-limited-quiescence-comparison.test.ts`

Vitestの既定sequencerは過去の失敗・実行時間キャッシュで順番を変えるため、比較6回だけ同一内容の一時configを各rootに置いた。元のvite.configを継承し、`maxWorkers: 2`、`fileParallelism: true`、上記順に並べるsequencerのみ明示。testTimeoutは5000msのまま。各ファイル内のテスト順序、環境指定、setup、isolationは変更しない。2ワーカー内部の完了順・実行の重なりはOSのスケジューリングによるため、完全に固定されたとは主張しない。

全回同じ `node node_modules/vitest/vitest.mjs run <上記8ファイル> --config .pr123-windows.config.ts --reporter=verbose --reporter=json --outputFile.json=<各回の証跡パス>`。違いはcwdと証跡パスだけ。[比較config](quiescence-ordering-windows-20260920/comparison-config.txt)、[実行runner](quiescence-ordering-windows-20260920/comparison-runner.txt)、[依存独立性・configハッシュ](quiescence-ordering-windows-20260920/independence.json)、[環境](quiescence-ordering-windows-20260920/environment.json)を保存。

比較中、別のVitest・benchmark・build・E2Eは一切起動せず、各プロセスの終了を確認してから次を開始した。ユーザーの常駐プロセスを停止してはいない。6回の予定を途中で変更せず、成功するまで追加で回すこともしていない。一時configは保存コピーとハッシュ一致を確認して6回終了後に削除し、通常検証ではリポジトリ標準configを使う。

## 6回の結果

対象テストの時間はVitest JSON reporterの各assertion.duration（ms）。合計時間は別途runnerが測ったプロセス全体であり、テストの時間と混同しない。

| 順 | 対象 | 終了 | 成功 / 失敗 | benchmark入力不変性 ms | 深さ3詰み枝 ms | プロセス全体 ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | main 1回目 | 1 | 290 / 1 | 700.825 | 5348.428（timeout） | 26930 |
| 2 | PR 1回目 | 1 | 290 / 1 | 724.150 | 5323.100（timeout） | 25875 |
| 3 | PR 2回目 | 0 | 291 / 0 | 789.746 | 2444.595 | 11137 |
| 4 | main 2回目 | 0 | 291 / 0 | 710.665 | 2628.232 | 11051 |
| 5 | main 3回目 | 0 | 291 / 0 | 778.486 | 1967.315 | 10931 |
| 6 | PR 3回目 | 0 | 291 / 0 | 1355.306 | 2157.918 | 10843 |

失敗は既存の5000ms時間超過だけで、値・推奨手・PV等のassertion不一致は報告されていない。問題の詰み枝テストは静止探索を指定せず、枝刈りなしの参照minimaxで深さ3の全合法枝を探索し、通常αβと比較する既存の重い統合テスト。PRのmaterial順序付けを呼ぶテストではない。両側の初回だけ同程度に遅いことから、PR固有の順序付けや材料表解決の性能回帰として本体を修正する証拠はない。

各回の全生出力は `quiescence-ordering-windows-20260920/compare-<順>-<main|pr>.txt`、全テスト詳細は同名`.json`、対象テスト抜粋と終了コードは同名`-summary.json`に収録。初回失敗を削除せず残した。

## 通常設定での再検証

比較後の追加検証は既定のsequencer・2ワーカー・5000msのままで直列実行。コマンド・開始/終了日時・終了コードは [validation-results.jsonl](quiescence-ordering-windows-20260920/validation-results.jsonl)に記録。これらの実行時間をCIの期待値にはしていない。

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

timedは完了反復だけを結果・統計へ採用する検証に成功。今回、初期局面の追加2手はoriginal深さ3 / material深さ2となった。他は両モードで深さ3/3/4/4/2（初期局面以外）。追加1手は初期局面を含めて両モード3/3/3/4/4/2。同一時間の異なる完了深さによる評価/PV差は正しさの失敗とは扱わず、全件を生出力へ記録する。依然としてmaterialの既定化は推奨しない。

## 調査コマンドの失敗と制約

- `Get-CimInstance`によるOS/CPU読取はアクセス拒否。読み取り可能なNode標準`os` APIで同じ情報を取得した。
- Windowsのrgへワイルドカードを含むパスを渡した2回の調査はos error123。ディレクトリ指定＋`-g`へ直してソースを確認した。
- 記録用Nodeプロセスから `execFileSync('git', ...)` を呼ぶとsandboxのspawn EPERMで終了1。子プロセスを使わず、親シェルで確認済みのSHAとNodeのos/fsのみで環境JSONを保存し、gitで再照合した。テスト失敗やソース問題とは別。
- 旧失敗記録、旧比較worktreeは保持。今回のmain worktreeも独立した依存を持つ比較用として保持する。ユーザーの未追跡変更を破棄・退避していない。
- 実時間は環境依存。初回の過負荷が再発し得るという注意は残るが、PR側だけに出る機能・性能回帰として扱う証拠はない。
- リポジトリ収録時には新しいテキスト証跡末尾の余分な空行だけを除去した。測定値・例外・終了コード・本文は変更しない。正規化前のファイルもrepo隣の `shogi-quiescence-ordering-evidence/windows-20260920-original` に保持している。

## 完了判断

Windows同条件比較で発生範囲を確認し、変更なしの通常設定で全体checkと新旧ベンチマークが成功した。PR固有の未解決機能回帰は観測されていない。既存の失敗を隠さず、追加資料とLOGのみを既存PR #123へ提出する。更新後CIを確認してReady for reviewへ移す対象とし、自動マージは行わない。初回負荷に対する5000msの余裕が常に保証されるわけではないこと、materialの既定化判断とは別であることは残る注意点。
