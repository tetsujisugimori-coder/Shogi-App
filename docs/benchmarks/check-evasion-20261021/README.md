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

全体checkと最終検証、実測結果・採用判断は実行後に追記する。
