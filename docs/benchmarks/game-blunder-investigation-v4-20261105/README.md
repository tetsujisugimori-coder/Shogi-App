# 悪手診断 v4：期限計測と固定条件の原因隔離

基準は `b244f4c8a5c02300343ab7f9d6c861c1f656588d`、ブランチは `codex/game-blunder-diagnostics`。
旧v3、旧proof、2026-10-30の未コミット調査成果を保持した追加版。探索エンジン・製品既定値・公開探索APIの変更はない。
総合判定と検証結果は `acceptance.json` に保存する。既定ローカル全体テストの時間切れと未解決の原因があるため総合は PARTIAL、マージ推奨は NO。

## 24局面の期限の内訳

4 journal、394手を監査・復元し、旧pilot JSONの24 IDを同順に採用した。
24回すべて最大深さ4を完了する前に1,000msの期限を検知した。完了深さ1が18件、深さ2が6件。
全件 `completed-iteration` を保持する。次の反復の中断と、完了済み反復の有無を区別する。
旧v3は `timedOut` を理由に比較を無効としており、これは「一度も探索結果が返らなかった」ことを意味しない。
v4は同じ時限探索の値だけで判定を緩めず、別に固定深さの同条件比較を行う。旧v3の結果は書き換えない。

| 区分 | 合計ms | 計測範囲 |
|---|---:|---|
| journal読取 | 251.65 | ファイル読取・チェックサム・チェーン検査・復号 |
| journal監査 | 25,937.53 | 全手/PVの合法性・評価整合性の検査と再生 |
| 候補局面復元 | 4,337.79 | 監査後の実手再生と候補snapshot作成 |
| 外部root合法手生成 | 23.95 | 各時限探索前の候補照合用 |
| 実手/旧代替手の構築 | 1.93 | 既存合法手一覧との照合 |
| 診断準備 | 5.21 | probeとカウンターの準備 |
| 内部root合法手生成 | 24.57 | 探索API内、探索期限に含む |
| 通常探索関連 | 3,485.12 | normal-*とSEE、排他的時間の和 |
| 静止探索関連 | 20,504.77 | quiescence本体とq-*、排他的時間の和 |
| APIその他 | 11.36 | 計測span外のAPI時間 |
| 時限探索呼出し全体 | 24,032.52 | 呼出し周辺と正規化前まで |
| 結果の正規化 | 3.22 | 完了済み反復の整合性確認とrow構築 |
| JSON直列化 | 33.73 | 全観測行、footer以外 |
| JSONL追記 | 281.56 | 全観測行、footerとfsync以外 |

監査・復元約30.5秒は探索期限外。各局面の共有journal費用と復元prefix時間もJSONLに保存した。
prefixは共通の順次再生の累積値であり、24件を合算してはいけない。読取はOSの純粋なディスク時間には分解していない。
静止探索関連は内部探索時間の約85.3%。この比率は計測ONの当該runの観測であり、独立した高速化効果の測定ではない。

期限検知時のphaseは quiescence 16、normal-other 8。
stageは before-quiescence-candidate 10、after-quiescence-action 6、quiescence-entry 4、normal-node-entry 4。
期限をまたいだ排他的phaseは q-execute 6、q-drop-own-check 5、q-evaluate 4、q-board-moves 3、
normal-execute 2、normal-legal 2、q-board-own-check 1、q-hand-drops 1。
検知の遅延は最大約2.72ms。検知stage、期限をまたいだ処理、計算量が多い処理は区別する。
根拠のある説明は「最大深さ4より先に期限に達し、その計測runでは静止探索関連が大半を占めた」まで。
停止条件の欠陥や特定の合法手生成の不具合は実証されていない。時間制限は増やしていない。

各rowにはID、探索設定、root合法手数、候補数、通常/qの全enter数、完了深さ、開始/終了状態、
最後の完了反復・完了node、検知phase/stage、deadlineの活動内訳、完了済み評価の有効性を保存した。
`deadline`、`node-limit`、`experiment-budget`、例外、部分結果、未実行を分離する。
通常のエンジン統計は完了反復だけを数えるため、今回の全enter数とは定義が異なる。

## 固定条件と再現性

既存 `analyzeAlphaBetaSearch` と `SearchDiagnostics.rootAction/traceNode` を再利用する。
新しい探索器は作成していない。root手を制限しても元手番と元の深さを保持するため、両候補の評価視点が揃う。
TT、killer、前反復PVはOFF、静止探索候補順はoriginal、非捕獲成りOFF、check追加延長0。
合法手の生成順と同点時の選択規則を固定し、乱数・共有探索cacheは使わない。

- 24局面の全root、通常深さ1/q1、各2回：48/48完了、24/24組で再現一致。
- 旧疑い4局面×実手/代替手×4条件×各2回：64/64完了、32/32組で再現一致。
- 一致対象は選択手、評価、PV、完了深さ、通常/q enter数、停止理由。実時間は一致条件に含めない。
- 全体は約84.25秒。事前上限は全体300秒、1呼出し1,500 enter・3秒。最大enter数を超える前に中断する。

enterは通常探索のhorizon entryと静止探索のentryも数え、root自体は数えない。
同期的な合法手生成、SEE、局面適用の最中を強制停止できない協調上限であり、CPU命令数や厳密なwall-time上限ではない。
最終操作後にも期限を確認し、期限超過した固定探索値を破棄する。中断/例外では `result:null`、完了深さ0、無効評価となる。
`compareFixed` は完了・同深さ・有限値だけを比較し、有限差から `CONFIRMED` を返さない。

詳細span計測OFF/ONの対照も旧4局面の実手で各2回行い、16/16回で結果とenter数が一致した。
ON/OFFの平均探索時間比は局面順に0.962、1.224、1.533、1.060。
標本が小さく順序固定でwarmupの影響もあり、低負荷や高速化を証明していない。短い探索での計測費用は無視できない。
詳細計測は診断呼出しに限定し、製品には追加しない。OFF対照もroot制限とnode guardは残す。

## 旧疑い4局面：実手と旧代替手

符号はすべて元手番視点で大きいほど有利。差は「代替手−実手」。値はエンジンの有限評価で、勝敗確率ではない。
下の座標は盤面の筋・段、括弧内は移動元。成/不成も候補JSONに保存する。

| journal / ply / 手番 | 実手 | 旧代替手 | d2/q1 実手 / 代替 | 差 | d2/q0 差 | d1/q1 差 |
|---|---|---|---:|---:|---:|---:|
| hirate-1 / 9 / 先手 | 8六歩(8七) | 5四角(4五) | 23 / 543 | +520 | −532 | −532 |
| hirate-1 / 20 / 後手 | 3七桂不成(2五) | 5三玉(5二) | 102 / 480.67 | +378.67 | −120 | −120 |
| hirate-2 / 36 / 後手 | 4九角成(8五) | 5二飛(4二) | −610 / 699 | +1309 | −318 | −318 |
| hirate-1 / 31 / 先手 | 5三香不成(5六) | 4四角(1一) | 516 / 1237 | +721 | −196 | −196 |

全候補の合法性を既存生成器で照合。実手後/代替手後の全合法応手は34/37、43/38、2/41、5/64手。
実手後の同一マスへの合法捕獲は1、1、2、3手で、それぞれの捕獲後に同一マスへの合法な取り返しは0手。
代替手直後の同一マスへの合法捕獲は4局面とも0手。
最初の合法捕獲を選ぶ有限の同一マス交換枝での駒差は、実手直後→捕獲後に
0→−200、+200→−400、+1200→−600、+200→−400。
代替手直後は+200、0、0、+200。成りの価値と持ち駒は既存material評価に含む。

全合法応手一覧、各即時捕獲後の合法取り返し一覧、有限交換枝、旧v3の記録済み交換、全比較PVをJSONLに保存した。
長い交換の全分岐、交換を拒否する手、離れた場所の王手、捨て駒の補償、最善応手の数学的保証は未解決。
通常深さは最大2、q深さは最大1であり、全合法応手を列挙したことと全戦術分岐を解いたことは異なる。
基準条件で4件とも差300以上の `SUSPECTED`、q0とd1では `NOT_CONFIRMED`。
設定に対する方向の不安定性があるため、局面単位の最終判定は4件とも `INDETERMINATE`、`CONFIRMED` は0。

## 一要因比較と原因仮説

機械可読の条件はplan/各rowにあり、集計器は変更leafが1個であること、その他条件・予算・候補・手番が同一であることを検査する。

| 要因 | 変更 | 観測 | 原因の確信度 |
|---|---|---|---|
| 静止探索の深さ | d2固定、q1→q0だけ | 4局面すべて評価差が反転 | 有限評価への影響は観測。実戦の悪手原因はUNKNOWN |
| 通常探索の深さ | q1固定、d2→d1だけ | 4局面すべて評価差が反転 | 深さ依存の仮説を支持。十分な深さはUNKNOWN |
| 既存SEE順序policy | moveOrderingだけstandard→static-exchange | 評価/PVは全4局面で不変。一部q enter数は変化 | 実戦原因の支持なし。純粋なSEE算術の隔離ではない |
| 期限 | 1秒での観測のみ | 24件で次反復が期限到達、完了反復は存在 | 期限と深さ未達の関係は観測。別予算の因果比較はUNKNOWN |
| 評価関数の係数 | 変更なし | 未実施 | UNKNOWN |
| 合法手/王手処理 | 既存生成器を利用 | 合法性検証、pin/check回帰成功 | 不具合の証拠なし。正しさ全体の証明ではない |

SEE policyでは実手/代替手のSEE span呼出し数は0/3、6/6、3/7、4/5（各rep0）。
旧実戦standard経路ではSEEは無効。既存static-exchange設定には捕獲/成り優先順位の変更も含まれるため、
SEE評価だけの効果と表現しない。少なくとも静止探索の深さの比較は他設定を固定した単独要因実験として成立した。
統計的有意差や棋力向上は測っていない。

## 56候補の再集計と限定証明器

A/B/C/D/E/F検出数は21/1/3/1/0/11、複数特徴11、特徴なし30。
元v3の判定はINDETERMINATE 24、NOT_RUN 32。特徴なしの意味はUNKNOWN。
特徴は悪手確定数ではない。検出精度や未検出領域の改善は今回の範囲では未実証。
全56 IDのラベル/判定をplanに保存し、`classificationCounts` で再計算する。

勝敗証明器は詰み・限定強制手順の検証用。通常中盤で勝敗証明できないことを不具合扱いしない。
v4の合法応手・交換・探索比較経路は証明器を呼び出さず、proofのunknown/時間切れに依存しない。
旧8手の時間切れ成果は保持し、証明成功に読み替えない。

## 再現・原本保全

Node v24.20.0 / npm 11.17.0 / Windows / タイムゾーンJST。
4 journalのSHA-256 before/afterは全一致し、plan/end/summaryに保存した。

| journal | SHA-256 |
|---|---|
| hirate-1 | 25fb004b362046c9f5af978825f4a66f1578b6ab7d17e633ac773f693556422b |
| hirate-2 | c1ee4522e95c6fe95fa69be3969137656155b8835b1a59a526e43480196d2c6f |
| replay-1 | 64df4641977cb4955013371283179ad1097c92669d0ff55dd831ed1b3e0cabb3 |
| replay-2 | 9f6e932e75a023c925cafd64bf2c52b53d5fcbe3b562b13cf52feaed7000270b |

開始時はtracked差分なし、未追跡334ファイル。`.tmp-tests` は一覧とhashを取りその場で保持し、
他9ファイルのソース/証拠を作業領域の親 `preservation-blunder-20261105` にZIP保全した。
`preservation.json` に開始status、初期hash、ZIP hashがあり、旧9ファイルの内容は現在も一致する。
ユーザー提示のAGENTS指示「回答末尾に日時」を適用。repoと祖先ディレクトリには追加AGENTS.mdを検出しなかった。

```powershell
node --import tsx scripts/investigate-game-blunders.ts NEW_DIR docs/benchmarks/game-blunder-pilot-balanced-20261029/candidates.json docs/benchmarks/game-blunder-rediagnosis-v3-20261030/diagnosis.json docs/benchmarks/match-journal-20261026/run1/hirate-1.jsonl docs/benchmarks/match-journal-20261026/run1/hirate-2.jsonl docs/benchmarks/match-journal-20261026/run1/replay-1.jsonl docs/benchmarks/match-journal-20261026/run1/replay-2.jsonl
node --import tsx scripts/summarize-game-blunders.ts NEW_DIR

# Windows sandboxの一時cacheは書込み可能な作業領域へ
$env:TEMP=Join-Path (Get-Location) '.tmp-tests/v4-20261105'
$env:TMP=$env:TEMP
$env:TMPDIR=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
npm test
npm run lint
npm run verify:lock
npm run build
```

NEW_DIRは存在しないパスを指定する。既存ファイルは上書きしない。
行ごとに追記するため、途中停止しても既に得た観測は残る。footer欠落は集計器が拒否する。
未完了行、重複、条件の不一致、保存した反復keyと実結果の不一致、原本hash不一致は成功に数えない。
計測時のHEADとdirty状態、ソースhash、入力hash、全上限はplanに記録済み。
今回の新しい実験コードはplanのsourceHashesと同一であり、実験後に製品・探索コードを変更していない。

## 変更ファイル・検証・提出

- `scripts/benchmarks/matchJournal.ts`：任意のjournal読取/監査時間を計測。省略時に追加の時計を読まない。
- `.gitattributes`：game-blunder成果と入力の改行変換を防止し、raw hashをOS間で維持する。`source-provenance.json` は実験時のraw hashとLF正規化hashを対応づける。
- `scripts/benchmarks/gameBlunderPilot.ts`：任意の復元/候補snapshot時間を計測。従来の1引数呼出しを維持。
- `scripts/benchmarks/gameBlunderInvestigation.ts`：固定条件、guard、候補検査、比較、分類集計。
- `scripts/investigate-game-blunders.ts`：24局面と4疑い局面の実験、append-only保存。
- `scripts/summarize-game-blunders.ts`：検証付き再集計。
- `src/test/game-blunder-investigation-v4.test.ts`：人工局面・固定時計・予算・合法性・一要因比較の回帰。
- `src/test/game-blunder-v4-journal-integration.test.ts`：実journal再生、両候補とPV、固定結果、hash、再集計、改変拒否。
- 既存未コミットの `gameBlunderFixed.ts`、旧調査runner/集計器、旧3テスト、旧結果3ファイルも変更せず保全・コミット対象とする。

関連330テスト、型検査（このrepoのlintは `tsc --noEmit`）、build、lockfile検証は成功。
初回関連テストはsandbox一時cacheのrename EPERMで11 suiteとも開始できず、0テスト実施。
作業領域内TEMPへ切り替えた再実行で11 suite/330テスト成功。失敗ログと成功ログを両方保持する。
全体テストの最終結果は `acceptance.json` とvalidationログを参照する。
既定2 worker/5秒では98 suite中96成功、2,584成功/2件時間切れ。
1 worker/5秒の追加試行でも既存3件が時間切れとなり、中断したため全体成功数には数えない。
制限外実行・既存の2 worker・テストランナー上限15秒では98 suite/2,586テストすべて成功（約186秒）。
15秒はテストハーネスの上限であり、探索の1秒制限、固定node数、製品既定値は変更していない。
環境とハーネス上限を同時に変えた再試行なので、個々の改善要因は隔離していない。
最終型検査も成功。既定ローカルの時間切れは解消済みとせず、R8はPARTIALとして記録する。

初回CI（df80b71）はUbuntu/macOSとも新しいソース来歴テストで失敗した。
実験ソースに混在するLF/CRLFの生hashは、checkout後の一様な改行のhash候補では復元できなかった。
実験時raw hashに現在の99ソースがbyte単位で一致することを再確認し、LF正規化hashを別manifestに導出した。
統合テストはraw実験hashとの対応とcanonical LF内容の両方を確認する。全99 git blobとのcanonical照合も成功した。
実験ソース/条件/JSONLを変えず、来歴テストと補足証拠を修正。修正後の関連2 suite/10テスト成功。
初回CIはUbuntu 2,585成功/1失敗、macOS 2,583成功/2 skipped/1失敗。失敗は同じ来歴テストのみ。
macOSの2 skippedは既存 `shogi.test.tsx` のdarwin条件によるもので、成功数に含めない。
初回の失敗ログもvalidationに保存する。最終HEADのCI結果はIssue #217の提出コメントと完了報告を参照する。

通常sandboxではCLIがinvalid token、Git接続が `getaddrinfo() thread failed to start`、GitHub接続ツールも利用不可だった。
制限外の読み取り専用再確認では既存CLI認証が有効であることを確認した。認証情報は変更していない。
関連Issue #209/#203を確認し、今回の受入条件を [Issue #217](https://github.com/tetsujisugimori-coder/Shogi-App/issues/217) に保存した。
`submission-status.json` はコミット前の提出snapshot。push・Draft PR・最終HEADのCI状態はIssue #217の提出コメントと完了報告で確認する。
提出用Issue/PR文面は `ISSUE.md` / `DRAFT_PR.md`。最終ローカルHEADは完了報告と `git rev-parse HEAD` で確認できる。
マージ、auto-merge、強制pushは実施していない。

## 未解決事項と次段階

改善優先順位はNOT_READY。悪手原因の確定も性能/棋力改善の実証もしていない。
次の最小実験は、同4局面を通常深さ3へ拡張してnode上限内で完了した対だけを比較し、
q候補生成と打切りを別々に観測すること。純粋SEE算術の隔離が必要なら、元standard経路にSEEがない点を踏まえて適用対象を再定義する。
評価係数と別時間予算の比較、30特徴なし候補の精度検証は未実施。全交換枝や補償を解くものではない。
独立レビューと最終HEADのCI確認までマージ推奨NOを維持する。

2026年11月5日 JST
