# PR #216 P2：探索結果と実験条件の整合検証

Issue #215 / 既存Draft PR #216、レビューHEAD `3adec10bfc55ee681c3f79bb36dddbe5530a6166`。
fetchしたremoteブランチも同一HEAD、mainは `4009cd0e808553af8f0ec9e01411a3eb6714560d`。作業ツリーはclean、同ブランチで修正する。AGENTS.md実ファイルはリポジトリ/親ディレクトリに見つからず、ユーザー提供の末尾日時指示を適用する。GitHub connectorは利用不可のためCLIでIssue/PR/レビューを取得。fetch設定がmainだけだったため対象branchを明示fetchした。重複Issue/PRは作らない。

## 修正前の再現と採用する契約

`red-depth.log`：新しい拒否期待値の6テストのうち5件失敗、正常な上限ちょうどの1件成功。最大深さ1にcompletedDepth 999/2を返すと通常3手を保存しmax_pliesで終わる。frame再計算済みの不正原本もcompleteとなる。`reproduction-before.json` は999がdepthCountsへ入った実結果。修正前コードとテストをbefore-sourcesに保存し、これら6テストの期待値は変更しない。

時限API（twoPlyAlphaBetaAi.ts）の実装を確認した。合法手のあるrootでは、各深さ1..maxDepthを順に完了し、deadlineで中断/開始拒否されたときだけtimedOutになる。したがってcompleted-iterationは1..宣言depth、partial-root/fallbackは0、timedOutはcompletedDepth < 宣言depthに一致する。depthはcompletedDepthと同じ、requestedMaxDepthは宣言depth、iterationsの長さと順次depthも整合する。終局/no-legal rootは別契約（深さ0・timedOut=false・手なし）であり、moveレコードには入れない。

既存の`validatePartialRoot`を再利用する。汎用self-playの合法手/PV/観測値チェックも維持する。既存の`validateTimeLimitedQuiescenceComparison`は固定の3条件/深さ/時間を受け取るUI比較API専用、`partialRootMatches.validateContract`はdepth=4固定の別実験用なので、そのまま流用しない。製品側の契約や関数は変更しない。

このjournalは時限APIの完全な返却結果を保存する。completedDepth、depth、requestedMaxDepth、timedOut、resultSource、iterations、rootLegalActionCount、通常/合計統計、elapsedMilliseconds、PVは取得必須で、null/undefined/欠落を代用しない。評価値/内訳のnullはfallbackの未評価だけを許容し、通常完了/partial-rootは既存の評価内訳契約を満たす。partialRootはpartial-root時だけ必須、その他でundefinedまたは省略を許容しnullは拒否。actualElapsedMillisecondsは呼出し側の任意計測なのでundefined/省略を許容し、存在する数値は有限非負（null不可）。無関係な追加診断値は推測・補正しない。

PV長=completedDepthは要求しない。終局で短く、q探索で長くなる場合がある。timeMsと実測時間の大小でも拒否しない（確認間隔や処理費用による超過がある）。不正値を丸めたり欠落値を埋めない。

保存前と読取り監査で同じ検証を行う。保存時は不正結果を通常のmoveへ確定せず、可能なら元の結果をfinalSearchと理由に残してsearch_failureで停止。既存の型付きcodecで非有限値・null・undefined・欠落を区別し、IO失敗後のwriter停止方針も変えない。失敗記録中の不正finalSearchは診断資料であり正常結果として再採用しない。保存済みmoveの条件矛盾はチェックサムが正常でもcorruptとし、完了/勝敗/ペア/深さ/時間の正式集計から対局全体を除外する。

## 原本とソース

修正前sealで旧1087原本、前回329証拠、測定ソースの保全を確認済み。前回の原本・監査・ログ・manifest・gzipは一切更新しない。今回の全出力はこの新規ディレクトリへ保存する。旧測定sourceは `05cbb8cdfe3b7574a630d22a3dfb9a75d379fdcb`、今回は保存データの監査ソースだけを更新する。1000msの実対局は原則再実行しない。

## 修正結果と回帰

原因は、汎用self-playがcompletedDepthの非負整数だけを検査し、journalの宣言depthとの対応を検査していなかったこと。`matchJournal.ts`の共通`validateJournalSearch`を保存前・move再生・手なし終局監査へ追加した。探索APIの計測は検証より前に終了するため、追加検証は対局全体時間へ入り、API時間には混入しない。journalIOの型付きcodec、fsync・書込み失敗後停止は変更していない。電源断耐性を新たに保証するものではない。

- 同じ6件の拒否/正常期待値は修正前5失敗・1成功から、修正後6成功。depth=999だけでなく最小超過2を拒否し、上限ちょうど1を許容。保存前と、frame/hashを再計算した不正原本の読取りを別に試験。
- 追加の契約回帰を含むjournal全125件（既存33＋新規92）、partial-root/paired self-playを含む関連3ファイル190件成功。最初の契約セット123件の原本は`contract-fixtures/`、追加2件の結果は`validation/related-final.log`。新規2件は手なし終局APIと破損片側の先後交換ペア除外を検証する。
- completed-iteration/partial-root/fallbackの実API正常例、浅い完了後timeout、PVが深さより短い終局・長いpartial-root、実測1004/1005msも受理。矛盾39種類は保存前・読取りでそれぞれ拒否。不正原結果は型付きで保持し、先行合法手だけを監査できる。
- 必須値のnull/undefined/欠落を拒否する一方、任意値のundefined/省略、fallbackの未評価null、合法なInfinity評価、codecの-Infinity等の区別を維持。journal有無の決定的結果互換、実子プロセス強制終了、容量/IO失敗など既存33件の期待値・timeoutは変更していない。

## 既存1000ms対局の再監査

測定は旧ソース`05cbb8c`による2026-10-26のrun1のまま。今回の修正で記録に不整合は見つからず、再測定は不要と判断した。4局394手・先後交換2ペアを合法再生し、legacy 2勝、experimental 1勝、規則引分0、120ply打切り1、未完了/破損/未実行0を確認した。手数打切りは引分ではない。

| 方式 | 手数 | 探索API合計ms（旧測定） | 深さ0/1/2/3 | partial-root / fallback |
| --- | ---: | ---: | --- | --- |
| legacy | 197 | 197285.88270000007 | 33/133/28/3 | 33/0 |
| experimental | 197 | 197293.13630000013 | 40/125/29/3 | 40/0 |

保存費用・全体時間も旧journalの観測をそのまま再集計した（[report](audit1/report.md)）。修正後の新しい測定値とは表記しない。少数対局による一般棋力向上は未実証、既定legacy/experimental研究opt-inを維持する。

新`audit1`と`audit2`は旧audit1/audit2ともsummary/reportのbyte一致を確認した。意味上の差もない。`validation/reaggregation-verification.json`に4組の比較を保存。

- summary SHA256: `4db95af66c2ba52350e539e32fa709bae6ae3c8a3d144074ab06ed5154eb0134`
- report SHA256: `1718bdc72316c342fc91b8e44cf2761e10d8de9ae9ffc885ba0b614e47071094`

旧1087原本は基準main `4009cd0`のGit blobと内容照合、前回329証拠は旧manifestのhashと完全一致。測定時111ソースgzipも展開hash/測定commitと一致。Windows CRLFとGit LFの差は比較時だけ区別し、原本を書き換えない。今回の原本hashの改行差・実内容差は共に0。旧manifest自身もレビューHEADとbyte一致（hash `1b9b785bd1d50968af47117a995b8ee152086568144b27eef1407c5682973ea9`）。測定ソース群のうち現在の差分は`matchJournal.ts`のみ。`environment-and-sources.json`と`after-sources/`に修正後監査ソースのhash/gzipを分けて保存。

## 再現コマンド

repo root、Node 24.20.0 / npm 11.17.0、Windows x64 / Intel Core i7-14650HX（詳細は`environment-and-sources.json`）。すべて新出力先を使う。既存のaudit1/audit2やfixtureディレクトリへは書き込まない。

```powershell
# 現在の契約回帰・既存中断/IO/互換回帰
npx vitest run src/test/match-journal.test.ts src/test/shogi-partial-root.test.ts src/test/shogi-paired-self-play-match.test.ts
# fixture原本を残す場合、未作成の出力先を指定
$env:MATCH_JOURNAL_EVIDENCE = '.diagnostic-temp/journal-review-new-fixtures'
npx vitest run src/test/match-journal.test.ts
Remove-Item Env:MATCH_JOURNAL_EVIDENCE
# 保存済みrawから新しい監査出力を2回生成
node --import tsx scripts/measure-match-journal.ts audit docs/benchmarks/match-journal-20261026/run1 .diagnostic-temp/journal-review-audit-a
node --import tsx scripts/measure-match-journal.ts audit docs/benchmarks/match-journal-20261026/run1 .diagnostic-temp/journal-review-audit-b
# 本提出の原本・監査bytes・ソース・manifestを検証
node --import tsx docs/benchmarks/match-journal-review-20261027/verify-evidence.mjs verify
npm run verify:lock
npm run lint
npm test
npm run build
git diff --check
```

修正前の再現は、レビューHEAD `3adec10b`の別checkoutへ`before-sources/src__test__match-journal.test.ts.gz`を展開し、`npx vitest run src/test/match-journal.test.ts -t 'journal timed search contract'`を実行する（新6件、既存33件skip）。修正後の6件は同じ期待値で成功。テスト拡充後は同名describeに追加ケースが含まれる。修正前コードのgzipも同ディレクトリに保持している。

`verify-evidence.mjs`は旧原本1087、前回manifest329、測定ソース111、修正前6件と既存33件の期待値不変、再集計bytes、今回の監査ソースを照合する。`seal`は新規manifestを排他的に生成し、`verify-index`はGit indexへ格納する新証拠のbytesも検査する。元の`seal-match-journal.ts`は現在のソースと測定時の一致を要求するので、修正後の確認にはこの明示的なソース区別を用いる。

## 最終検証と残課題

lock検査（399 entries）、型検査/lint、全体91ファイル2558件（skip/失敗0、181.73秒）、production build（1762 modules、15.15秒）が成功。全体ログにjsdom navigation未実装メッセージがあるが、テスト失敗はない。`validation/`に各原ログを保存した。diff-checkとmanifest/Git indexの照合も提出前に実行する。最終commitに対するUbuntu/macOS CIは既存Draft PR #216本文へ記録する（manifestの自己参照を避けるためCIの追記で原本群を上書きしない）。ローカルWindowsではmacOS固有fsevents検査とclean npm ciは未実施で、CI結果と区別する。

製品の探索/評価/係数/合法手/終局/Worker/UI/利用者保存形式は変更していない。ピン・合法取り返し・独立した深い参照評価は次段階の課題。棋力向上は未実証のまま、Draftを維持して独立再レビューを待つ。マージ・自動マージは行わない。
