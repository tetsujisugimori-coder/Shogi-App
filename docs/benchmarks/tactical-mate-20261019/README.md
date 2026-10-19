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
node --import tsx scripts/audit-tactical-observations.ts docs/benchmarks/tactical-mate-20261019/run1
```

prepareの親ディレクトリは事前作成する。出力は新規作成のみ。runは既存environmentとtracked差分を拒否、元データを上書きしない。auditは保存summaryがなければrawから生成、あれば完全一致をassertする。plan/参照hashと局面再生成、全root手・全防御応手の証明書、結果の合法性・PV・評価内訳・partial契約・各60セルの一意性を監査する。

`environment.json`は実装SHA・ソースhash・環境・開始時刻・計画/参照hash。`raw.jsonl`はAPI結果を丸ごと保持し、選択手/評価/内訳/PV/深さ/source/timeout/通常・q訪問数/partial attempted統計を省略しない。`+Infinity`/`-Infinity`/`NaN`は文字列で往復しnullと区別。APIにないフィールドは省略（未取得）し合成しない。固定深さにはcompletedDepth/source/timeoutがないためsummaryの該当欄はnullとmodeを併記する。fallbackの評価nullは未評価。通常/total訪問数は完了反復、partial attempted統計も中断qの全作業量ではない。

callMsは入力保護後、API呼出し直前から直後の単調時計。apiMsはAPI内のelapsedMilliseconds、超過はmax(0,callMs-budget)、固定探索には予算超過を定義しない。親停止時はcallMs/apiMs/overrunMsが未取得nullで、起動等込みparentWallMsを別保存する。1本ごとの選択の期待一致と終局スコア発見を別分類する。一致が距離感度の存在を意味するわけではない。

## 実測結果

測定SHA `6c5c0a6b4ac562a01ad770e6c731414363fc9ecb`、tracked/untrackedともclean。2026-10-19 20:05:59.945〜20:06:31.108 JST、Windows 10.0.26300 x64、Intel Core i7-14650HX、Node v24.20.0、npm 11.17.0。各ソースhashはenvironment.json。本測定60/60成功、warmup6件除外、打切り/拒否/例外/欠測0。固定d4も全て15秒以内。独立参照は全10局面で制限内終了。実測後に追加したobservations監査は新しい探索をせず保存済みPV・証明書だけを再生する。測定時コード/計画/rawは保持し、製品コード・局面・条件は変更していない。

スコアはroot視点。+∞/-∞は終局勝敗スコアで、詰み以外の終局も含む。

| 局面 | 固定d1 q0 / q1 / q2 | 固定d4 q1 | 固定の期待との照合 |
|---|---|---|---|
| mate-sente | +∞ / +∞ / +∞ | +∞ | 全て1ply詰み |
| mate-gote | +∞ / +∞ / +∞ | +∞ | 先後反転でもroot勝ちを正方向に評価 |
| mate-three | 504 / 504 / 504 | +∞ | 全て正解初手だが浅い3条件は終局スコア未発見 |
| mixed-distance | +∞ / +∞ / +∞ | +∞ | 全て1plyを選ぶ。候補別では1/3ply同点 |
| resistance | -1001 / -1001 / -1001 | -∞ | 参照の4ply詰み側を選択。ただし非詰みの早期終局あり |
| evasion | -1005 / -1005 / -1005 | -1205 | 合法回避。永続的な詰み回避は判定不能 |
| recapture | 552 / 399 / 399 | 599 | q0だけ取り返される歩を取り局所期待不一致 |
| capture | 1103 / 1103 / 1103 | 1304 | 全て保護されない歩を取る |
| recapture-gote | 552 / 399 / 399 | 599 | 先後反転でも同じq0見落としとq1改善 |
| hirate-exchange | 799 / 799 / 799 | 1010 | 合法再生/PV一致。詰み回避の正解は判定不能 |

| 局面 | 100ms q1：score / 完了深さ | 1000ms q1：score / 完了深さ |
|---|---|---|
| mate-sente | +∞ / 2 | +∞ / 4 |
| mate-gote | +∞ / 2 | +∞ / 4 |
| mate-three | +∞ / 4 | +∞ / 4 |
| mixed-distance | +∞ / 4 | +∞ / 4 |
| resistance | -∞ / 4 | -∞ / 4 |
| evasion | -1005 / 3 | -1205 / 4 |
| recapture | 502 / 2 | 599 / 4 |
| capture | 1304 / 3 | 1304 / 4 |
| recapture-gote | 502 / 2 | 599 / 4 |
| hirate-exchange | 798 / 2 | 597 / 3 |

固定40件：局所期待/参照目的と一致30、不一致2、判定不能8。時間制限20件：一致16、不一致0、判定不能4。resistanceの一致はcheckmate-only参照に対する一致で、実際の延命の証拠ではない。mate-threeの浅い初手一致と詰み発見も別分類。棋力勝率・独立標本の統計とは解釈しない。

時間制限は全20件completed-iteration。timedOutは100msで7件、1000msで1件。実呼出し超過最大は各0.5319/0.5323ms。partial-root/fallbackは0件。今回大幅超過がなかっただけで厳密時間保証ではない。partial-rootの実例はなく候補スコア/PV不整合の有無は実測から判断不能。結果を受けて追加測定はしていない。

## 原因の切り分けと未解決事項

- **探索不足**：mate-threeはd1/q0・q1・q2で504、d4と両時間制限で+∞。初手が正しくても浅い探索で詰みを発見したとはいえない。初手後は王手でも駒取りでもないためq2は静かな玉応手を全て読む通常深さ3の代わりにならない。resistanceも浅い3条件では必敗スコアを返さない。
- **Infinity同点**：mixed-distanceの独立に証明した1/3plyの候補が固定d4/q1の候補別探索でともに+∞。元順first-maximumモデルは1ply、逆順モデルは3plyを選ぶ。製品rootは元合法手indexを優先し1plyを選んだので、現行が短い詰みを外したとは報告しない。ただしスコアに距離感度がないことは確認した。比較モデルは製品内部の順序全体を反転した実測ではない。
- **終局理由と延命**：resistanceの玉(0,0)/(0,2)には4/2plyのcheckmate-only証明があり、候補スコアはともに-∞。しかし(0,0)の保存PVは相手金(2,3)→(1,2)で2plyのno_legal_actions、(0,2)は同じ金の手で2plyのcheckmate。双方とも次の相手手で規則上敗北できるため、最適な実際の終局距離は両方2ply。この局面は「4ply延命できるのに2ply負けを選ぶ」の再現ではない。相手が別の手を選ぶ詰み証明の距離を、最適な対局終局の距離と混同しない。真の異距離必敗の比較は未検証として、新局面を追加せず終了した。
- **静止探索境界**：取り返しのq0見落としは両側でq1/q2により回避。深さ上限/静かな手を対象外にする仕様に関係する観測で、qの不具合とは断定しない。適用時に終局した1ply詰みはq0を含む全条件で評価され、通常/q境界で終局見落としは再現しなかった。
- **終局評価/PV**：全保存PVは合法で末端standard内訳と選択評価が一致。追加監査ではended-stateのgetLegalActionsが無条件で[]を返すゲートに頼らず、コピーをactive/check・result=nullとして応手を再列挙。詰みは王手/応手なし、no_legal_actionsは非王手/応手なしを確認した。現行のno_legal_actionsルールを不具合扱いしない。
- **参照未確定**：evasion/hirate-exchangeは上限内に強制詰みを証明できず安全の証明もない。合法王手回避は確認できるが、詰み回避に成功したかは判断不能。

`observations.json`は全60PVの終局理由、候補probeの終局理由と参照mate距離を併記。audit本体はraw→summary一致、追加auditはraw/probe/証明木→observations一致を再生成する。両方とも既存ファイルがあれば一致をassertし書換えない。

次の優先順位は、(1)終局理由を区別した内部距離比較の設計と1/3ply局面の回帰、(2)no_legal_actionsも考慮した真の異距離必敗局面の参照整備、(3)静かな手を含む通常深さ到達率と時間制限下の戦術品質、(4)partial-root発生局面での距離/PV整合。評価係数やq仕様の変更が必要とは結論づけない。

## 検証

`validation/check.txt`は通常check成功（73ファイル/1,970件、型/lock/build）。追加監査・10件目の不正終局回帰を含む最終通常checkも成功（73ファイル/1,971件、型/lock/build 1,759 modules）、原本は`validation/final-check.txt`。両監査はrawからの再生成後、再実行でも完全一致。git diff --check成功。長時間診断をCIへ追加せず、短い診断単体テストだけを既存CIで実行する。失敗原本・原因は以下に残す。最終HEADの公開CI結果はPR本文に記録し、その記録だけでHEADを再変更しない。

## 失敗記録

- 初版の型検査は候補配列のimplicit anyとError.codeの型で失敗。明示型を追加して修正。
- 初回runは測定前のplan照合で停止（environment/rawは未生成）。合法再生APIが作るoptionalな`isPromoted: undefined`/`branchFrom: undefined`がJSONでは省略され、オブジェクトdeepEqualが不一致となった。局面/条件/参照は変更せず、照合を既存のcanonical JSON hashへ修正。null/Infinityと未取得の区別は維持し、往復hashの回帰を追加した。
- sandbox内の新規テスト起動はWindows Temp内rename EPERMで0件実行のまま失敗。製品/timeoutを変えずsandbox外の通常実行で検証する。
- 開始時のsandbox内git fetchは.git/FETCH_HEADの書込み拒否、ghは接続拒否。許可されたsandbox外実行でfetch/PR/Issue読取りに成功した。既存チェックのjsdom navigation通知は失敗0と区別する。
- 参照局面作成時、既存q fixtureの同一筋の歩2枚を発見。診断の合法性条件を満たさないため金に置換してから測定局面を固定。最初の既存詰みfixtureだけでは3ply勝ちを確認できず、エンジン結果を見る前に独立した両玉＋金局面を作成・検証した。負け局面の最初の案も4ply内必敗を確認できず不採用。これらは期待成立性の事前確認であり、測定結果による局面選別ではない。

## 次の製品変更の設計候補（本PRでは未実装）

今回のresistanceの制約から、no_legal_actionsも探索で到達する決着として扱う必要がある。checkmateにだけ距離を付けると、即時の別理由の勝敗との優先順位が曖昧になる。内部比較には全ての規則上の決着の`terminalDistancePly`を用い、公開`mateDistancePly`は詰みの証明に限定する案が妥当。保存終局理由を維持し、千日手等の引分へ勝敗距離を付けない。

距離差がスコアから失われることを実測で確認できた場合は、探索不足の対策と別にmate-distanceを導入する。root視点で勝ち`M - terminalRootPly`、負け`-M + terminalRootPly`なら最短勝ち・最長抵抗になる。ただし任意の評価テーブル/係数も存在するため、単に大きい有限Mを選ぶだけでは有限静的評価への優越性を保証できない。勝敗カテゴリと距離の辞書順比較（勝ちは距離昇順、負けは距離降順、有限値同士は従来評価）を第一案とする。alpha/beta、厳密値/境界値、root同点再探索にも同じ比較型を適用する必要がある。

通常再帰の既存`ply`はroot候補直後が1。終局評価でこのrootからのplyを読む。qは新たなrootを作らず通常葉のplyを引き継ぎ、qで1手進むごとに増やす。反復深化の各反復でも同じroot基準。q上限の王手局面は未証明の静的近似のままで、予測距離を付けない。先後の符号はroot視点で固定し手番を変えても評価方向を入れ替えない。

互換性を保つ段階導入なら、公開`selectedEvaluation`/`evaluationBreakdown.total`の±Infinityと既存terminal内訳を保持し、内部比較専用距離とoptionalな`mateDistancePly`/証明済み属性を追加する。有限の探索スコアを公開する場合は別フィールドにし、現行「selectedEvaluationと内訳totalが一致」「terminal=win/lossなら±Infinity」のWorker/UI/保存・検証契約を黙って変えない。PV末端の静的評価と探索順位の情報を分けて明示する。

PV、評価内訳、距離メタデータは同じ採用候補から一体でコピーする。partial-rootは完了したexact候補だけに距離を保持し、未完了・境界値を詰み証明へ昇格しない。候補間距離比較もroot基準で行い、source/completedDepth/attempted統計契約を維持する。fallbackは評価null/空PVのまま距離未取得。root終局は距離0（詰み以外の終局理由にmate距離を付けない）。通常/q境界、先後、短勝ち/延命、Infinity同点、反復/partial-root/Workerの回帰を同じ固定局面で検証する。
