# Issue 217 独立レビュー修正の証拠

## A. 判定

総合はPARTIAL、マージ推奨はNO。P2-01/P2-02/P3-01は実装と固定HEADの正常/負対照を完了した。Windowsの5秒失敗は間欠的に残り、R8はPARTIAL。最終HEADのCIと独立レビューの確定状態は提出時のPRコメントに記録する。改善優先順位はNOT_READY、旧疑い4局面はINDETERMINATE、CONFIRMEDは0を維持する。

## B. 修正

- P2-01の原因は、結果だけを含むrepeatKeyの一致を条件同一性の代用としていたこと。再集計ではjournalのチェーンと原本hashを検証し、全合法手を再生して56候補を復元する。24選択IDは独立したpilot入力に照合し、選択局面の再計算hash、mode、条件全体、予算、rep、候補の制限、合法PVを検証する。
- 新しいschema 3は実行時のpositionHashを全fixed観測に保存する。schema 2は保存された旧runnerのhashに限って互換読込し、欠けていたhashをjournal-reconstructedと表示する。schema 3の欠落hashやschemaの単純な降格を拒否する。
- P2-02の原因は、変更項目数の1だけを検査し、条件名に対応した変更先を固定していなかったこと。baselineはdepth 2 / q depth 1 / standard orderingを固定し、q0、depth1、see-orderの名称と設定全体を固定の条件契約に照合する。planと観測を一緒に変更しても拒否する。
- SEEは既存の順序policyの比較として扱う。純粋SEE算術の効果と歴史的悪手原因はUNKNOWN。
- P3-01の原因は、root反復の成功判定に有限な完了結果が必須となっていなかったこと。finite-completed、有限score、requested/completed/result深さの一致、node統計、PVと候補の整合性、指定depth/qのPV長とq手種、PV葉で再評価した全内訳の一致を必須にした。
- 無効結果をinvalidObservationsに原因・件数・ID・条件・repとともに保存し、rootの正式scoreと候補評価差から除外する。構造・同一性・出所・条件違反は再集計を失敗させる。
- 製品探索・公開API・既定設定の保全をGit差分と原本hashで検証する。診断用candidate ID計算を共用した。

条件契約の変更前後は次の値へ固定した。全行でkillerMoves、previous PV、TTをfalse、q orderingをoriginal、quiet promotionsをfalse、check-evasion extensionを0とする。

| 条件 | 許可する変更項目 | 変更前 | 変更後 | 残るdepth/q/ordering |
|---|---|---|---|---|
| baseline | 基準設定 | depth 2 / q 1 / standard | 同じ基準値 | depth 2 / q 1 / standard |
| q0 | options.quiescence.maxTacticalDepth | 1 | 0 | depth 2 / standard |
| depth1 | depth | 2 | 1 | q 1 / standard |
| see-order | options.moveOrdering | standard | static-exchange | depth 2 / q 1 |

## C. 正常対照と負対照

正式な固定HEAD比較は基準e1ccb1a対実装1edc169で行った。red-green-fixed.jsonと対応ログを参照。正常1件は両版で受理。29負対照中、旧誤受理から拒否・除外へ変わったものは21件、旧版で既に保護されていたものは8件だった。各ケースに入力変更、入力SHA-256、旧判定、新判定、実際のプロセス終了コード、原因を保存する。旧判定が拒否・除外だったケースは新しい修正成果に数えない。

P2-01は10ケース中6件、P2-02は4ケース中4件、P3-01は15ケース中11件で旧誤受理を実証し、新版の拒否・原因付き除外を確認した。

red-green.jsonは実装中の探索的な試行であり、正式な固定HEAD証拠は後続のred-green-fixed.jsonを使用する。正常対照は旧schema 2を意味的に変更せず、旧版と新版の両方へ渡す。既知の制約は旧証拠の未記録事項を実行時証拠へ格上げできないこと。

## D. Windowsの5秒問題

旧ログが指す2件は次のテストだった。

- match-journal.test.ts の accepts terminal PV shorter than completed depth and measured deadline overrun。旧ログでは6221msで時間切れ。
- shogi-two-ply-minimax-ai.test.ts の深さ3の途中で詰みへ到達した枝のテスト。旧ログでは5488msで時間切れ。

old-timing.jsonには基準HEADでの単独5秒、2ワーカー5秒、2ワーカー15秒を各2回記録した。全8試行が成功し、対象テスト本体は593〜933msだった。OS、Node、worker数、TEMP、cache保持方針、実行順、全所要時間、個別テスト所要時間をJSONとverboseログに保存した。

新HEADの全体テストと追加比較はtest-runs.json、各fullログ、追加Windows計測を参照。テストランナーの上限とAI探索の時間/node上限は別々に記録する。timeout設定と既存assertionの保全をGit差分で確認する。原理的な原因が確定しない結果はUNKNOWNとし、5秒の失敗が残る間はR8をPARTIALとする。

実装1edc169でsandbox外の既定5秒全体を2回反復した。1回目は2573成功/14失敗、終了1。内訳はrunner timeout12、UI要素検索失敗2、別にunhandled AbortError1。2回目は2587件すべて成功、終了0。同HEADの15秒は2587件すべて成功、終了0。最初の2テストは両全体試行とも成功しており、本体時間は664〜1797msだった。

実装4d626a4でのsandbox既定5秒全体は、1回目2571成功/15 timeout、2回目2574成功/12 timeout。15秒は2586成功。後続1edc169では結果統計の検査と回帰テスト1件を追加した。各HEAD・設定をJSONに記録した。

sandboxとhostではreporterの取得条件にも差があり、sandbox単独の因果効果はUNKNOWN。CPU/メモリ/GC/他プロセスの時系列観測が揃っていないため、正確な原因はUNKNOWN。environment.jsonのRAM値は1時点の補足観測として保存する。

## E. 検証

最終実装1edc169の関連7 suite / 29テスト、型検査、build、lock検証が成功した。host-test-runs.jsonとexperiment-environment-fixed.jsonを参照。

test-runs.jsonと各ログに固定HEAD、コマンド、終了コード、所要時間を保存する。失敗した全体試行も保存する。最終HEADのUbuntu/macOS CIは提出コメントで確定報告する。

探索用baselineをrepo内へ展開した初回のrelated-first.logは追加suiteを拾った。baselineをrepo外へ移し、固定HEAD検証では98 suiteで実行した。初回の不整合な有限値fixtureも、内訳と値を揃えた正常対照へ修正した。初回失敗と後続成功のログをともに保存する。

関連テストの変更では、再集計/PVの検証を既存の30秒のjournal統合テストへ置いた。既定5秒で行える構造違反・条件違反の検査を別テストに保ち、関係するtimeout値は変更していない。

## F. 原本と再集計

originals-before.jsonとoriginals-after.jsonは旧tracked証拠44ファイルと4 journal、計48ファイルの作業前後SHA-256を照合する。

旧ディレクトリに残っていた11個のignored rawログは作業開始時manifestに含めていなかった。legacy-raw-log-verification.jsonでは作業後のrawログを基準HEADのgzip blobから展開したbytesと比較し、全11件の同一性を確認する。開始時hashの取得範囲と、この作業後のarchive照合範囲をmanifestに明記する。

新schema 3はroot48呼出しの24反復組、pair64呼出しの32反復組、probe16呼出しの4組を全件検証し、無効観測0だった。実手/代替手の差はbaselineで520 / 378.66666666666663 / 1309 / 721、q0とdepth1で-532 / -120 / -318 / -196、see-orderではbaselineと同じ値になった。timedは24件とも次反復がdeadlineに達し、15件がdepth1、9件がdepth2を完了していた。原本source99件は実装1edc169のGit blobとcanonical LFで一致した。

旧56件のA/B/C/D/E/Fは21/1/3/1/0/11、重複11、特徴なし30 UNKNOWN、INDETERMINATE24 / NOT_RUN32を維持する。旧正常データの再集計はlegacy-reaggregated-fixed.jsonに別保存し、旧summary.jsonとの同値性を検証する。

baseline-sourcesは変更対象となった4旧ソースの基準HEAD blobをgzip保存したもの。旧canonical source provenance検査はこのsnapshotを使い、変更後のソースを過去のソースと比較して失敗させることを防いだ。残る旧ソースは現checkoutのcanonical LF hashで照合する。

## G. 独立レビュー

実装ファイルを編集していないサブエージェントが固定実装1edc169を独立検証した。正常1・独自負対照14の全15件が期待通り。P2-01/P2-02/P3-01はPASSで閉鎖可、新規未解決指摘0。Windowsの原因UNKNOWNにより総合PARTIAL・マージ推奨NO。independent-review.md、independent-results.json、independent-audit.jsonを参照。入力原本、実行ハーネス、コマンド、探索的v1と正式v2の全結果はindependent-review-evidence.tar.gzと一覧manifestに保存した。最終証拠HEADとCIの照合は提出コメントで追補する。

## H. 提出

Issueは https://github.com/tetsujisugimori-coder/Shogi-App/issues/217 。
既存Draft PRは https://github.com/tetsujisugimori-coder/Shogi-App/pull/218 。
最終HEADとpush状態、最終CI状態は提出コメントに記録する。Draftを維持する。

runnerは出力ディレクトリ作成後にsourceDirtyを収集する。既存.tmp-testsや新しい出力ディレクトリのためtrueになり得る。実装の固定はplanのbaseHead、全sourceHashes、source-provenance-fixed.json、tracked source差分で照合する。

ログ原本はlog-manifest.jsonのSHA-256と対応する.log.gzから復元できる。

## I. 再計算

基準版ソースは次のコマンドで別ディレクトリへ展開できる。依存パッケージは現checkoutにあるロック済みnode_modulesとNode 24 / npm 11を使う。baselineには製品srcとscriptsの基準HEAD blobを置く。

```powershell
git archive --format=zip --output=baseline.zip e1ccb1a2412e7faa86c2c1f60fdad1dca154023a src scripts package.json tsconfig.json
Expand-Archive -LiteralPath baseline.zip -DestinationPath ../baseline-source
node --import tsx scripts/verify-game-blunder-review.mjs ../baseline-source NEW_RESULTS_JSON
```

新schema 3の実測では、既存の4 journal、pilot-balanced candidates.json、v3 diagnosis.jsonをscripts/investigate-game-blunders.tsに渡す。出力ディレクトリは新規に作成する。実コマンドとsource hashは新実験のplanとexperiment-environment-fixed.jsonに記録する。再集計にはscripts/summarize-game-blunders.ts NEW_OUTPUT_DIRを使い、summary.jsonも新規ファイルとして保存する。

旧失敗ログ・旧観測・旧summary・旧journalは保持する。新しい測定と再計算はこのディレクトリ以下へ追記する。

未確定事項はWindowsの間欠的な5秒失敗の原因と、UIの二次的な要素検索/AbortErrorの因果関係。start-git-observed.txtが証拠ディレクトリ作成前に観測したGit状態。start-git.txtは最初のhash manifest保存後の追加記録。初期tracked差分は0、既存未追跡は.tmp-testsのみだった。

最小の次実験は、固定HEADとsuite順を揃え、CPU/RSS/GC/pagingの時系列を採取する既定5秒の反復とする。

2026年11月11日 JST
