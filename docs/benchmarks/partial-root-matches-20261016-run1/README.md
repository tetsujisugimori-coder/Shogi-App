# C方式導入前後の同一時間対局診断

Issue #188。製品の探索・評価・UIには変更を加えない。最新remote mainをfetchし、`70a9a0f753abf76dd24d605caa361e06f17f1266`と一致、その後の差分なしを確認。元checkoutはclean。既存worktree一覧、PR #187本文・コメント、最終修正`7291246`、partial-root-c/fallback-qualityの両README、自対局・結果検証・保存形式・集計を確認した。適用される指示はユーザー指定の回答末尾日時。リポジトリ内にAGENTS.mdはなかった。他作業は変更せず、専用branchと独立engine checkoutを新規作成した。

## 測定前の固定計画

旧`cc37291a121a9bf72cef222ff472e5d2f1e90f45`、C`70a9a0f753abf76dd24d605caa361e06f17f1266`。同一Node/npm・マシン、評価standard、最大深さ4、通常順序standard、killer=false、静止追加1手/original。実時間performance.now、探索clock引数undefined、diagnosticsなし。候補別hook・追加時計なし。

初期局面と、既存保存自対局4局の20/30/40/50手終了時を順に使用。最初は全4局20手終了時を試したが、事前のdistinct検証で重複（初期を含め3種類）が分かった。対局開始前に上記へ修正し、5種類のpositionKeyを確認した。この事前失敗はログに保持。C方式の過去の評価差・勝敗を選択に使用しない。ただし同じ旧方式の保存4局が出典で、局面間に共通の棋譜があり、無作為・独立標本ではない。過去C測定の特定10局面を再利用したものではない。

`positions.json.gz`は合法再生手順と履歴・持駒・手番・反復履歴・snapshotを含む完全state。recordIdだけ固定。`plan.json`に出典byte hash、入力byte hash、全設定、20局の順序を事前保存した。局面ごとに先後交換を1ペアとし、100/1000msで各5ペア10局、計20局。ブロックごとに予算順・C先手開始順を交替、ペア内は隣接。全局を同期直列実行。各局200plyは診断上限であり、引き分けにしない。評価による投了・早期終局はしない。ウォームアップは初期局面、100→1000ms、各実装2回、2巡目は実装順反転（計8呼出し）。全20局を単体テストで再実行しない。

予算合計の上限約37分、検証・ログ保存等を含む測定見積40〜55分。20局の結果/失敗、着手と終局分類の監査、rawからsummary再生成一致、必要なコード検証完了で終了。結果によって追加局・設定変更をしない。

## ハーネスと互換性

同一ハーネスから独立checkoutの絶対file URLで両API・プリセット・局面キー・合法手APIを読み込む。エンジン関数と合法手関数の参照が異なることをassertし、相対importのグラフもcheckoutごとに分離。探索ドメインソースを現行のフラグで模倣しない。各着手の計時前に両エンジンの局面キー・合法手一覧が現行ルールと一致することを確認。presetは各checkoutから取得。入力は既存runSelfPlayGameの独立再帰Proxyで保護し、前後hashも検証。

API直前〜直後だけをcallMsとして記録。API内部elapsedMillisecondsは別にapiMs。超過はmax(0, 実測−予算)としAPI側も別保存。入力保護・hash・同一局面確認・結果検証・ログは計時外。runSelfPlayGameで手番・合法手・PV・内訳・partial metadataを着手前検証。さらにrequestedMaxDepth、root手数、sourceと反復/partial契約を検証する。不正結果を補完せずfailedにする。

両SHAの旧APIにはsource/depth/evaluation/PVが既にあるため、フィールドの合成・推定は不要。partialRootが存在しない旧方式/通常結果はそのまま未取得（省略）。nullはAPIの未取得、Infinity/-Infinity/NaNは既存診断同様に文字列化して区別し、監査で復元。通常/total統計は完了反復のみ、partialのattemptedStatisticsはAPI既存値のままで、中断q内部の全作業量ではない。

`attempts.jsonl.gz`は全探索試行のAPI結果・局面hash・実装・予算・時間・例外。`game-NN.json.gz`は対局ID・開始ID・予算・先後・実行順と既存自対局結果（全着手・最終完全state・終局理由/診断打切り/失敗）。各実装SHAと全設定はplan/environmentとの結合で一意。拒否された探索結果もattemptsに残す。`warmup.jsonl`は本集計に混ぜない。`events.jsonl`は対局開始終了時刻。計測途中のraw journalは毎着手同期appendして保存し、完了後gzipも保存する。

## 再現と監査

```powershell
git worktree add --detach ../old cc37291a121a9bf72cef222ff472e5d2f1e90f45
git worktree add --detach ../c 70a9a0f753abf76dd24d605caa361e06f17f1266
npm ci
node --import tsx scripts/measure-partial-root-matches.ts prepare NEW_OUTPUT
node --import tsx scripts/measure-partial-root-matches.ts run NEW_OUTPUT ../old ../c
node --import tsx scripts/measure-partial-root-matches.ts audit NEW_OUTPUT
# 保存済みデータの再監査（探索なし、summaryがあれば一致をassert）
node --import tsx scripts/measure-partial-root-matches.ts audit docs/benchmarks/partial-root-matches-20261016-run1
```

runは同じ出力への再実行を拒否。監査は各着手の記録済み結果を既存runSelfPlayGameへ戻し、入力hash・実装・予算・手番・合法性・PV・契約・時間超過、全着手・最終state・分類・件数一致を確認する。summaryがなければ再生成、あればdeepEqual。保存棋譜の合法手順と完全stateを保持しv1製品形式は変更しない。

勝率は規則上終局の局のみ分母にし、引分0.5点、打切り・失敗の除外件数を明記。着手頻度は対局数ではない。対局が分岐した後の平均時間/深さを同一局面での速度差と解釈しない。少数かつ相関のある開始局面なので一般的棋力改善の確定には使わない。

結果・検証記録は測定後に追記する。
