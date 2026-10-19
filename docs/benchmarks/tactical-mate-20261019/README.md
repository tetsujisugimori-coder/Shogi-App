# 戦術評価・mate-distance診断

製品変更を含まない診断。最新origin/main `21c6677a9767af0c3c75f2e44b649a7f7207724d`から専用`codex/tactical-mate-diagnostics` / `.worktrees/tactical`を作成。元checkoutはclean。既存全worktreeを確認して変更せず、リポジトリに追加AGENTS.mdなし。ユーザー指示は回答末尾日時。#187は`70a9a0f`、#189は`21c6677`へマージ済み。関連Issue一覧を確認し、#188/#186/#185/#183/#181、README/LOG、partial-root-c/fallback-quality/partial-root-matches、既存合法手・終局・評価・探索・棋譜監査を参照した。

## 責務と固定計画（測定前）

`legalActions`公開APIは合法手列挙と検証付き適用、着手後の詰み/反復を既存規則で判定する。`twoPlyMinimaxAi`はroot視点の評価と内訳、終局の±Infinityを提供。`twoPlyAlphaBetaAi`は固定深さ・時間制限反復深化・PV・partial-root。通常内部ノードの同点は先に訪れた候補、rootは同点時に元合法手indexを優先する。`quiescenceSearch`は王手時に全回避、通常時に駒取り、同点ならstand-pat/先行手を維持し、深さ0では静的近似。既存`protectSearchInput`、`validatePartialRoot`、PR #189の`validateContract`と非有限値JSON/hashを再利用。PVは合法再生し末端のstandard内訳を再評価して完全一致を検証する。

10局面×6条件、各1本。固定d1/q0・q1・q2、固定d4/q1、100/1000ms最大d4/q1。全てstandard評価・standard通常順序・killer=false・q original。PR #189と同じAPI末尾引数を使用しclock=undefined、診断hookなし。各子プロセスで独立測定し親15秒上限で同期呼出しを停止。固定探索を無制限に待たず、停止結果は未検証として残す。参照は局面ごと最大60,000ノード/8秒、最大3ply（resistanceのみ4ply）、深さ4超の参照条件はない。結果を見た後の局面・条件追加や再試行をしない。

各条件1回の別プロセスwarmupを単純な両玉局面で実行し、raw本測定とは別保存。さらに各本測定子プロセス自身でも計時前に両玉のd1/q(当該条件)を1回実行し、processWarmupへ分離記録する。独立プロセス間でJIT状態は引き継がず、局面や深い分岐が十分温まった保証はない。速度比較の精密統計ではなく、1本の観測を報告する。テスト/build/他の性能測定とは並走しない。OS負荷・GC・電源・CPU affinityは固定していない。

独立AND/OR参照は評価関数・エンジン探索・q・枝刈り・順序付けを使わない。勝つ側は全合法手の存在量化、守る側は全合法手の全称量化。各root候補で1plyから順に強制勝ちの成立を確認し、最初の成立plyを距離とする。勝つ側は最短、守る側は最長抵抗になる。全称ノードの全応手を証明木へ保存する。終端は合法手0・王手・敗者の一致を再確認する。参照は合法手/適用/王手APIを共有するためルール実装から独立した外部エンジンによる証明ではない。`no-force-within-bound`は上限内の強制詰みなしであり、永久の安全・不詰証明ではない。

追加の候補別診断はmixed-distance/resistanceの2局面だけに事前固定。全root候補を適用し、子を固定d3/q1で独立検索して子root視点の符号を反転（終局は元root視点で評価）。この候補スコア配列を元順/逆順のfirst-maximumで比較する。これは独立した同点処理の比較モデルで、製品の手順序を変更した実験ではない。内部PVの同点処理も完全に反転した探索とは解釈しない。

## 局面の根拠

完全state、由来、目的、期待分類、探索条件は`run1/plan.json`。構成局面は盤上・持駒のID/数/所属、両玉、二歩・行き所なし・前手番の自玉王手・手番の王手状態・履歴キー整合を確認する。省略駒は問題外であり持駒に追加しない。平手からの到達可能性は主張しない。hirate-exchangeのみ平手から公開合法手で6ply再生し履歴・持駒を維持。

mate-sente/goteは既存checkmate fixtureの先後反転。mate-threeは後手玉(0,0)、先手玉(2,1)、先手金(3,0)、金(2,0)→玉の全応手→金の詰みの3ply。初手が王手の連続王手詰将棋ではなく、相手の全合法応手に対する強制勝ち。mixed-distanceは同じ後手玉/先手玉、金(2,0)/(3,2)で1ply/3plyの勝ち。resistanceは後手玉(0,1)、先手玉(2,1)、金(2,3)/(3,0)、後手番。玉(0,0)なら4ply、(0,2)なら2ply。全手順は参照証明木で機械監査する。

recaptureは既存q fixtureを基に、二歩になる2枚目の後手歩を金へ変更した。飛(5,4)×歩(4,4)を金(3,4)が取り返せるためその駒取りを避けるのが局所期待。captureは取り返す金なし、駒取りを期待。recapture-goteは180度回転・先後交換。これらの局所期待は大局的な最善手・強制詰みの証明ではない。evasionは王手回避の全合法手、hirate-exchangeは実戦形式の入力を確認する対照群。参照未確定なら判定不能とする。

## 保存形式と再現

```powershell
npm ci
npm run diagnose:tactical -- prepare docs/benchmarks/tactical-mate-NEW/run1
# 計画・参照を確認して固定（本測定前にcommit）
npm run diagnose:tactical -- run docs/benchmarks/tactical-mate-NEW/run1
npm run diagnose:tactical -- probe docs/benchmarks/tactical-mate-NEW/run1
npm run diagnose:tactical -- audit docs/benchmarks/tactical-mate-NEW/run1
# 保存済みrawから集計を再生成/照合（探索なし）
npm run diagnose:tactical -- audit docs/benchmarks/tactical-mate-20261019/run1
```

prepareの親ディレクトリは事前作成する。出力は新規作成のみ。runは既存environmentとtracked差分を拒否、元データを上書きしない。auditは保存summaryがなければrawから生成、あれば完全一致をassertする。plan/参照hashと局面再生成、全root手・全防御応手の証明書、結果の合法性・PV・評価内訳・partial契約・各60セルの一意性を監査する。

`environment.json`は実装SHA・ソースhash・環境・開始時刻・計画/参照hash。`raw.jsonl`はAPI結果を丸ごと保持し、選択手/評価/内訳/PV/深さ/source/timeout/通常・q訪問数/partial attempted統計を省略しない。`+Infinity`/`-Infinity`/`NaN`は文字列で往復しnullと区別。APIにないフィールドは省略（未取得）し合成しない。固定深さにはcompletedDepth/source/timeoutがないためsummaryの該当欄はnullとmodeを併記する。fallbackの評価nullは未評価。通常/total訪問数は完了反復、partial attempted統計も中断qの全作業量ではない。

callMsは入力保護後、API呼出し直前から直後の単調時計。apiMsはAPI内のelapsedMilliseconds、超過はmax(0,callMs-budget)、固定探索には予算超過を定義しない。親停止時はcallMs/apiMs/overrunMsが未取得nullで、起動等込みparentWallMsを別保存する。1本ごとの選択の期待一致と終局スコア発見を別分類する。一致が距離感度の存在を意味するわけではない。

## 失敗記録

- 初版の型検査は候補配列のimplicit anyとError.codeの型で失敗。明示型を追加して修正。
- sandbox内の新規テスト起動はWindows Temp内rename EPERMで0件実行のまま失敗。製品/timeoutを変えずsandbox外の通常実行で検証する。
- 参照局面作成時、既存q fixtureの同一筋の歩2枚を発見。診断の合法性条件を満たさないため金に置換してから測定局面を固定。最初の既存詰みfixtureだけでは3ply勝ちを確認できず、エンジン結果を見る前に独立した両玉＋金局面を作成・検証した。負け局面の最初の案も4ply内必敗を確認できず不採用。これらは期待成立性の事前確認であり、測定結果による局面選別ではない。

## 次の製品変更の設計候補（本PRでは未実装）

距離差がスコアから失われることを実測で確認できた場合は、探索不足の対策と別にmate-distanceを導入する。root視点で勝ち`M - terminalRootPly`、負け`-M + terminalRootPly`なら最短勝ち・最長抵抗になる。ただし任意の評価テーブル/係数も存在するため、単に大きい有限Mを選ぶだけでは有限静的評価への優越性を保証できない。勝敗カテゴリと距離の辞書順比較（勝ちは距離昇順、負けは距離降順、有限値同士は従来評価）を第一案とする。alpha/beta、厳密値/境界値、root同点再探索にも同じ比較型を適用する必要がある。

通常再帰の既存`ply`はroot候補直後が1。終局評価でこのrootからのplyを読む。qは新たなrootを作らず通常葉のplyを引き継ぎ、qで1手進むごとに増やす。反復深化の各反復でも同じroot基準。q上限の王手局面は未証明の静的近似のままで、予測距離を付けない。先後の符号はroot視点で固定し手番を変えても評価方向を入れ替えない。

互換性を保つ段階導入なら、公開`selectedEvaluation`/`evaluationBreakdown.total`の±Infinityと既存terminal内訳を保持し、内部比較専用距離とoptionalな`mateDistancePly`/証明済み属性を追加する。有限の探索スコアを公開する場合は別フィールドにし、現行「selectedEvaluationと内訳totalが一致」「terminal=win/lossなら±Infinity」のWorker/UI/保存・検証契約を黙って変えない。PV末端の静的評価と探索順位の情報を分けて明示する。

PV、評価内訳、距離メタデータは同じ採用候補から一体でコピーする。partial-rootは完了したexact候補だけに距離を保持し、未完了・境界値を詰み証明へ昇格しない。候補間距離比較もroot基準で行い、source/completedDepth/attempted統計契約を維持する。fallbackは評価null/空PVのまま距離未取得。root終局は距離0（詰み以外の終局理由にmate距離を付けない）。通常/q境界、先後、短勝ち/延命、Infinity同点、反復/partial-root/Workerの回帰を同じ固定局面で検証する。
