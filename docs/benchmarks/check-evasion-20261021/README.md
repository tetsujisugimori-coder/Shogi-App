# 王手回避の限定拡張

## 基準と作業保護

基準main: `8248857d5c2fd4dea0a23e1b0de8f013c1ddc0f2`。2026-10-21 JSTにfetchし、GitHubで #190/#192/#194/#196/#198/#200 がすべてMERGEDであることを確認。順にmerge SHAは `6cd961b699a9985a0ff73ca6a93bb7bbdaa2b2ef`、`34d3689e96200b9ecc4a417e15a0ed0012cb2cd3`、`519a332c36ad97dacdaae8c09a20a8e08bf511be`、`f5fdb17c777f34e4db34d903135f6a5dc88e93c9`、`b031decd02ed32a036e43d88829a217cc385b70d`、基準SHA。関連Issue #201。

元mainは未コミット/未追跡変更なし。既存worktreeを一覧確認し、変更せず `.worktrees/check-evasion` / `codex/check-evasion-extensions` で作業。リポジトリのAGENTS.mdは存在せず、ユーザー提供の回答末尾日時指示を適用。README/LOG、戦術・終局距離・PV・TT各診断を参照した。既存の原本は変更しない。

## 責務・設計

`legalActions` は全合法手列挙と検証付き非破壊適用。`checkmate` は攻撃判定と合法応手有無。着手適用後の既存adjudicationが詰み・合法手なし・履歴終局を決める。`twoPlyMinimaxAi` が終局/有限評価と内訳を提供し、`searchValue` がroot視点のカテゴリ・勝ち最短/負け最長を比較する。αβは通常探索、反復深化、期限、partial-root、fallback、TTを所有する。qは通常時stand-patと駒取り、王手時全合法応手を同じ窓で探索する。従来のq0は王手判定前に静的評価を返す。

`quiescence.maxCheckEvasionExtensions` を明示した場合だけ、通常q予算を使い切った王手局面で追加応手探索を許す。整数0〜2、既定0。不正値（null/小数/負数/3以上/非有限値/文字列等）はRangeError。通常q予算と追加予算は別々に再帰へ渡し、追加中は駒取りや静止深さを復活させない。各分岐で最大q+追加ply。合法応手を列挙し、通常のαβ以外の枝選別はしない。非王手のq0は静的評価へ戻る。拡張対象のカスタム王手根で応手0なら共通の合法手なし評価で終局を評価する。通常着手後の終局・カテゴリ/距離比較・評価係数は変更しない。

追加上限後も王手なら静的近似へ戻り、探索呼出し全体にcap到達を伝播する。これは詰み・不詰の証明ではない。capを含む結果はpartial-rootのexact候補から除外する。中断例外は捕捉せず既存SearchDeadlineExceeded処理へ伝播し、最後の完了反復→期限承認exact候補→従来fallbackの優先順を維持する。完了反復の評価は有限探索の値であり完全な戦術証明ではない。

拡張有効時は祖先を含む全通常ノードでTTを迂回する。追加履歴horizon・cap/観測統計を含む再利用の安全性を今回証明しないためで、既存killer時と同じ安全な拒否経路。TT=trueを無視して別探索へ切り替えるのではなく、safetyRejectsで観測できる。追加0のTTは従来通り。既定TT/PV/Worker/UIはOFFのまま。

再帰入口、追加部分の合法手生成前後、候補適用前後、再帰復帰で協調的期限確認する。同期の合法手生成・適用・評価は強制停止できず、100ms以内の復帰は保証しない。

`CheckEvasionStatistics` は別の任意観測。αβ公開呼出し開始時にresetし、追加適用の試行数、最大追加ply、王手のままcapに到達した回数を記録する。中断反復も含む。q単体の末尾statistics引数は呼出し間で累積可能。既存通常/q/total統計は従来どおり完了したq呼出し/反復だけで、意味を変更しない。q訪問数には追加の子も含むため追加数との単純加算は二重計上となる。

## 固定対象・参照

結果を見る前に14局面を固定。PR #190の10局面をそのまま利用し、countercheck/先後反転、single-evasion/先後反転の4局面だけ追加。single-evasionは合法回避1手、countercheckは5手、既存evasionは4手。countercheckでは飛車で相手飛車を取って王手を返す分岐があり追加1/2の境界を検証できる。完全入力・合法性検査・条件は `run1/plan.json`。構成局面は両玉・駒数上限・ID・二歩・行き所・前手番の自玉安全・手番王手状態・履歴キーを検査。省略駒は問題外で、持駒には補わない。平手到達可能性はhirate-exchangeの合法6手再生だけを主張する。

製品変更前のq0/1/2を `baseline.json` に保存。αβの基準mainは元checkoutから別module graphで読込み、14局面×d1/2の全結果/統計（経過時間のみ除く）を `baseline-alpha-beta.json` に保存。実装後の省略/明示0と完全照合する。王手q0の静的近似の存在と、その選択が悪手になることは別の判断である。

`run1/references.json` は既存の独立AND/OR強制詰み参照（上限60,000ノード/8秒、3ply、resistanceのみ4ply）。全候補の存在/全称探索と全防御応手の正証明を保存・再生する。上限内で詰みが見つからないことを永続安全と扱わない。checkmate限定参照であり、他の終局や一般棋力の最善証明ではない。独立全幅 `checkEvasionReference.ts` は製品探索・SearchValue・枝刈り・順序/TTを使わず、同じ有限horizonと逆順でカテゴリ/距離/内訳を検証する。合法手・適用・静的評価は共有するので、外部ルールエンジンからの独立ではない。

## 測定方法・再現

standard評価/通常順序、killer=false、前反復PV=false、TT=false、q1/original。追加0/1/2のA/B/C。各局面で固定d1、固定d4、最大d4の100/1,000ms。各cellをwarmup1回後に本測定（固定1回、時間制限3回）。3つの永続Node processを同一コードSHAから起動し、ABC/BCA/CABをwarmupを含めて回転し、呼出しは直列。入力保護、結果監査、IPC、保存は探索時計外。API内時間と呼出し実時間を別保存。測定とテスト/build/参照を並走させない。親60秒の検証専用停止があれば失敗記録を残し、成功扱いしない。

```powershell
npm ci
node --import tsx scripts/measure-check-evasion.ts prepare docs/benchmarks/check-evasion-NEW/run1
# 計画とコードをcommitして固定、tracked差分なしを確認
node --import tsx scripts/measure-check-evasion.ts run docs/benchmarks/check-evasion-NEW/run1
node --import tsx scripts/measure-check-evasion.ts audit docs/benchmarks/check-evasion-NEW/run1
```

出力は新規作成のみ。runは既存environmentとtracked差分を拒否。`environment.json` のSHA/ソースhash・環境、`sources.json` の実測ソースbytes、完全入力・参照とhash、warmup/raw、完了hashを保存。auditは件数/一意性、raw/warmup hash、元ソースhash、全PV合法再生と末端内訳、時間超過式、追加上限、partial契約を検証しsummary/resultsを再生成する。非有限値は既存JSON形式でnullと区別する。

同一時間条件のノード比較は完了深さの違いを含む。既存普通/q統計は中断内部作業を完全には観測しない。追加統計と母集団が違う。固定各1回、timed各3回の探索的実測であり、OS負荷、JIT/GC、CPU周波数/affinity/電源を固定せず一般的な速度/棋力の改善を断定しない。p95はnearest-rank。少数標本でtail推定は不安定。

## 検証・失敗記録

`validation/` に実行原本。最初のテスト起動はsandbox TEMPのrename EPERMでテスト開始前に失敗。workspace内TEMP/TMPで通常設定のまま再実行した。依存junctionの作成もアクセス拒否され、親ディレクトリの既存node_modulesを通常Node解決で使用した。製品の依存・test timeout・worker数・既存アサーションを変更していない。

初回関連テストは2失敗/112成功。αβ→qの新しい末尾引数の接続漏れを、中断時の追加統計0とpartial不成立が検出。接続修正後114件成功。初回型検査は既存mockの内部q戻り型に新しい必須flagがない問題を検出し、内部flagを後方互換のoptional型へ修正した。cap実装時は常に明示返却する。

初回 `npm run check` はlockfile/型検査成功、80ファイル2,124成功/1失敗（計2,125）。既存 `quiescence-ordering-repeated` の528独立snapshotを作る `runs 3+8 per setting...` が6.659秒で通常5秒timeout。2回目の通常checkも同じ1件が5.901秒でtimeout、他2,124件成功。どちらもbuildへ進まず終了1であり、full check成功とは扱わない。同じテストを含む関連7ファイル209件は通常設定で成功した。失敗テストは注入mock探索と終局fixtureの複製を使い変更エンジンを走らせないが、今回の全体失敗の原因を確定した証拠ではない。個別production buildは1,761 modules、17.88秒で成功。jsdom navigation未実装通知はテスト失敗とは別。

境界検証 `validation/boundary.json` は14局面×q0/1×追加0/1/2＝84条件。各条件を全幅/逆順全幅とカテゴリ・数値/距離で比較し、全PV末端内訳・入力非破壊を照合した。応手なしのカスタム詰み、既に終局した入力、窓端/枝刈り、deadline中断、capのpartial拒否、TT迂回は新規40テストと既存回帰で検証した。[別観点のレビュー](review.md)に責務/安全性/測定設計の再確認を記録した。

## 今回の実測結果

測定コードSHA `fcebfd8159e6f5809da0fe44fee7a7f91686e7e9`。2026-10-21 **23:41:16〜23:43:22 JST**、Windows 10.0.26300 x64、Intel Core i7-14650HX、Node v24.20.0、npm11.17.0。tracked差分なし。環境statusには検証TEMPの`.tmp/`と、environment作成前に生成したsources.jsonの未追跡状態をそのまま記録した。未追跡製品ソースなし。測定後の変更は文書・offline集計・検証用スクリプトと成果物だけで、製品2ファイルと測定CLIのbytesは測定時のまま。

**504呼出し＝warmup168＋本測定336、全成功。例外・欠測・hard-stop・結果拒否0。** 全入力を保護・hash照合し、全評価済みPVを合法再生して末端内訳と一致。時限252件はすべてcompleted-iterationで、実時間partial/fallbackは観測0（制御時計回帰とは区別）。raw/warmup/元ソースhashと件数/一意性/参照証明/summaryの再監査も成功。npm版取得の固定コマンドがNodeのDEP0190警告を出したが、測定開始前の環境取得であり、失敗や探索時間には含めない。

[全体比較表](run1/results.md)、[局面別の選択/評価/実時間](run1/positions-details.md)、[224対の比較と分布/終局発見集計](run1/comparison.json)、[再集計可能な完全summary](run1/summary.json)。元の `positions.md` は最初の派生表であり、同じデータを使う動的な再生成版がpositions-details.md。測定原本はraw.jsonl/warmup.jsonl。

| 指標 | A 追加0 | B 追加1 | C 追加2 |
|---|---:|---:|---:|
| 112本ずつの参照一致 / 不一致 / 判定不能 | 56 / 0 / 56 | 56 / 0 / 56 | 56 / 0 / 56 |
| 王手で始まる40本ずつの合法回避成功 | 40 | 40 | 40 |
| 固定d4 通常 / qノード合計 | 32,295 / 11,662 | 32,387 / 12,552 | 32,387 / 12,552 |
| 固定d4 追加ノード | 0 | 1,926 | 1,926 |
| 固定d4 実時間合計ms（14局面×1） | 7,428.668 | 7,644.371 | 7,689.473 |
| 100ms 実時間p50 / p95 ms（n=42） | 100.118 / 100.676 | 100.127 / 100.456 | 100.124 / 100.521 |
| 100ms 最大超過ms | 1.327 | 0.786 | 0.602 |
| 100ms 完了d2 / d3 / d4 | 15 / 12 / 15 | 15 / 13 / 14 | 15 / 13 / 14 |
| 1000ms 実時間p50 / p95 ms（n=42） | 278.271 / 1000.173 | 277.563 / 1000.198 | 272.427 / 1000.165 |
| 1000ms 最大超過ms | 0.209 | 0.245 | 0.243 |
| 1000ms 完了d3 / d4 | 9 / 33 | 9 / 33 | 9 / 33 |

### A. 正確性

テストした範囲では合法手・終局カテゴリ/距離・評価/内訳・PV・入力非破壊・期限/partial/fallback/TT契約を維持。省略と追加0は基準mainの全42q条件・28固定αβ結果と経過時間以外完全一致。安全な限定実装として採用可能。ただしローカルfull checkの既存timeoutは未解決で、外部エンジンによるルール独立証明ではない。

### B. 戦術品質

**選択手の変化0、参照判定の変化0（B/C対Aの224対）。改善を確認していない。** 参照一致56本は最短checkmate/局所capture述語の一致で、一般の最善手証明ではない。判定不能56本を安全/正解に数えない。各構成王手局面での回避は従来方式でも成功し、追加拡張による救済例ではない。

hirate-exchangeの固定d4評価は1010→1000、1000ms・完了d3では597→807へ変わるが、全て同じ成香への着手を選ぶ。100ms evasionの1反復だけA完了d4/B・C完了d3で -1205→-1005となり、着手は同じ。計10対で評価/PVが変わったことを品質改善とは扱わない。

終局スコアの観測数は各方式共通。固定d1はwin3/非終局11、d4はwin4/loss3/非終局7、100msはwin12/loss3/非終局27、1000msはwin12/loss9/非終局21。mate-threeのd1で未発見、d4で発見という既存境界も同じ。返却された±Infinityや一本のPVだけでは、全応手に対する必敗/強制勝利の独立証明にしない。

直接q0の王手静的近似は再現・拡張で再評価できたが、**この固定集合で、その静的近似が実際に不適切な選択手を生む独立証明は得ていない**。境界仕様の存在・値の変化と、実際の誤選択/改善を区別する。

### C. 性能

固定d4は通常ノード+0.28%、qノード+7.63%、合計実時間はB+2.90%/C+3.51%。100msでevasionの1標本がd4→d3になり、1000msの深さ分布は同じ。最大超過の小さな減少はOS/JIT/GCの揺れを除けず速度改善とはしない。countercheck近辺には同一条件で100ms弱から500ms台までの揺れもあり、固定1本/時限3本の精密な負荷差推定はできない。

主測定は追加最大1ply・cap到達0で、B/Cの固定探索ノードは同じ。追加2plyの連続王手処理は直接q0の回帰/全幅参照で検証したが、今回のq1同一時間実測に2plyの追加価値・最悪費用の証拠はない。重い持駒・長い連続王手・実戦勝率・CPU profileは未測定。

### 総合採用判断：B

**安全だが戦術改善効果は未確認。既定OFFの実験オプションとして限定採用し、既定ONを推奨しない。** 重大な品質破壊は観測しなかったが、追加の負荷と一部完了深さ低下がある。次は独立した深い参照で誤選択が確定するhorizon局面を事前固定し、外部エンジン/より多い反復と実戦で品質を検証する。その前にローカル既存snapshotテストの負荷依存timeoutを別課題として切り分ける。

再監査と追加境界検証（出力先は新規ファイル）：

```powershell
node --import tsx scripts/measure-check-evasion.ts audit docs/benchmarks/check-evasion-20261021/run1
node --import tsx scripts/report-check-evasion.ts docs/benchmarks/check-evasion-20261021/run1
node --import tsx scripts/verify-check-evasion-boundary.ts NEW-boundary.json
```

最終PR HEADとCI対象SHA、Ubuntu/macOSの結果はPR本文に記載し、この実測SHAとは区別する。マージ/自動マージは行わない。
