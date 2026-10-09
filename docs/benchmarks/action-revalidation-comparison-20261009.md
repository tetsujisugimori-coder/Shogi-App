# 合法手生成後の実行時再検証診断

基準main: `57378c2dfbad1b3d83908cf9dea077824baa4a39`（PR #174）。診断計測HEAD: `57378c2dfbad1b3d83908cf9dea077824baa4a39`、dirty=true。
保存棋譜: `docs/benchmarks/timed-fallback-100ms-20260924.jsonl`。SHA-256: `8b269f95bb3be422ab87fe2e64d1a5dcc342cf53048eb63d3c2424ebfbf1e552`。
環境: win32 10.0.26200 x64 / Intel(R) Core(TM) i7-14650HX / Node v24.20.0。
条件: g1-p115、g3-p55、g4-p89、g1-p93。標準評価・標準手順序・静止探索追加1手（original）、最大深さ4・100ms通常探索、固定深さ1完走。各系列は独立プロセス、同期直列、4局面を各巡回、各2ウォームアップ＋本測定5回。
生成（root・通常・静止）と実行（root・通常・静止）をすべて対象とする。新診断はSearchDiagnostics第4引数をtrueにした場合だけ有効。既存の細粒度checkInternalsはOFF。時計はSearchDiagnostics.beginへ渡したperformance時計を全段階で使用する。

## 実コードの呼出経路

`getLegalActions` / `getQuiescenceLegalActionsWithDiagnostics` → `getLegalMoves` → 擬似合法手列挙 → 候補ごとの局所盤面準備 → `isKingInCheck` → 成り選択列挙。生成側ではvalidateMoveは呼ばれない。generationBoard.validationは擬似候補1件の盤面準備＋自玉王手確認の包含、pseudo列挙時間は別欄。
同じ生成API → `getLegalDropSquares` → 全81マスで`validateDrop` → 引数・駒・二歩等 → 局所盤面準備 → 自玉王手確認 → 直接王手の歩だけ打ち歩詰め確認。
`executeLegalAction` → `executeMove` → `validateMove` → 擬似合法手再列挙 → 公開simulateMoveSquaresによる盤面全複製 → 自玉王手確認。成り検証はexecuteMove内の後続工程。
`executeLegalAction` → `executeDrop` → `validateDrop` → 同じdrop検証・盤面準備・自玉王手・条件付き打ち歩詰め。公開APIの検証を維持し、内部適用経路は作成していない。

## 固定深さ1：実行と再検証

| 局面 | executed board | executed drop | execution validateMove | execution validateDrop | 再検証関連時間ms（中央値） | 再検証/API %（中央値） | completedDepth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| g1-p115 | 86 | 272 | 86 | 272 | 96.88 | 4.21 | 1 |
| g3-p55 | 71 | 181 | 71 | 181 | 74.61 | 7.93 | 1 |
| g4-p89 | 64 | 207 | 64 | 207 | 82.56 | 6.83 | 1 |
| g1-p93 | 66 | 249 | 66 | 249 | 87.96 | 4.54 | 1 |

board/dropとも execution validation / executed action = 1.00（drop実行0件は比率未定義）。上表の再検証時間はboard+drop validationの包含だけを足す。executeやown-checkの包含を重ねて足さない。時間は診断ON内の補助値で、通常探索や将来の削減率へ外挿しない。

## 生成側と処理量

| 局面 | root候補 | visited normal / q | generation board候補検証 | generation validateDrop | generation own-check board / drop | execution own-check board / drop |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| g1-p115 | 314 | 314 / 44 | 9858 | 51273 | 9858 / 35224 | 86 / 272 |
| g3-p55 | 222 | 222 / 30 | 3815 | 18306 | 3815 / 6288 | 71 / 181 |
| g4-p89 | 249 | 249 / 22 | 2781 | 20493 | 2781 / 10736 | 64 / 207 |
| g1-p93 | 289 | 289 / 26 | 7150 | 47223 | 7150 / 29557 | 66 / 249 |

own-check回数は対応するisKingInCheck呼出数。打ち歩詰め内部の相手玉確認・応手生成、実行後の終局・反復判定、探索q-checkはこの欄の対象外。実走査マスは今回計測しない。両側同じ合法性要件を再確認するが、boardの生成側は局所複製、実行側は全複製で、完全に同一処理ではない。

| 局面 | 既存q-board-own-check | 既存q-drop-own-check | executeLegalAction総数 | 包含時間中央値ms |
| --- | ---: | ---: | ---: | ---: |
| g1-p115 | 9818 | 34952 | 358 | 765.18 |
| g3-p55 | 3776 | 6107 | 252 | 530.47 |
| g4-p89 | 2741 | 10529 | 271 | 596.79 |
| g1-p93 | 7112 | 29308 | 315 | 699.78 |

既存PR #172/#174の生成側q-own-check回数と一致し、今回のgeneration合計はroot生成分も含む。既存の細粒度王手内部資料との時間比較は行わない。

## 包含段階（診断ON、各5本で回数一致・時間中央値）

| 局面 | 呼出元 | 段階 | 回数 | 包含ms |
| --- | --- | --- | ---: | ---: |
| g1-p115 | generationBoard | execute-action | 0 | 0.00 |
| g1-p115 | generationBoard | execute-api | 0 | 0.00 |
| g1-p115 | generationBoard | validation | 9858 | 229.01 |
| g1-p115 | generationBoard | pseudo | 2210 | 6.51 |
| g1-p115 | generationBoard | board-setup | 9858 | 38.86 |
| g1-p115 | generationBoard | own-check | 9858 | 123.68 |
| g1-p115 | generationBoard | pawn-drop-mate | 0 | 0.00 |
| g1-p115 | generationDrop | execute-action | 0 | 0.00 |
| g1-p115 | generationDrop | execute-api | 0 | 0.00 |
| g1-p115 | generationDrop | validation | 51273 | 1000.36 |
| g1-p115 | generationDrop | pseudo | 0 | 0.00 |
| g1-p115 | generationDrop | board-setup | 35224 | 337.19 |
| g1-p115 | generationDrop | own-check | 35224 | 441.89 |
| g1-p115 | generationDrop | pawn-drop-mate | 286 | 75.36 |
| g1-p115 | executionBoard | execute-action | 86 | 165.00 |
| g1-p115 | executionBoard | execute-api | 86 | 164.81 |
| g1-p115 | executionBoard | validation | 86 | 48.53 |
| g1-p115 | executionBoard | pseudo | 86 | 0.52 |
| g1-p115 | executionBoard | board-setup | 86 | 44.84 |
| g1-p115 | executionBoard | own-check | 86 | 1.63 |
| g1-p115 | executionBoard | pawn-drop-mate | 0 | 0.00 |
| g1-p115 | executionDrop | execute-action | 272 | 591.16 |
| g1-p115 | executionDrop | execute-api | 272 | 590.54 |
| g1-p115 | executionDrop | validation | 272 | 44.73 |
| g1-p115 | executionDrop | pseudo | 0 | 0.00 |
| g1-p115 | executionDrop | board-setup | 272 | 15.35 |
| g1-p115 | executionDrop | own-check | 272 | 23.23 |
| g1-p115 | executionDrop | pawn-drop-mate | 1 | 0.36 |
| g3-p55 | generationBoard | execute-action | 0 | 0.00 |
| g3-p55 | generationBoard | execute-api | 0 | 0.00 |
| g3-p55 | generationBoard | validation | 3815 | 98.49 |
| g3-p55 | generationBoard | pseudo | 2898 | 7.44 |
| g3-p55 | generationBoard | board-setup | 3815 | 16.67 |
| g3-p55 | generationBoard | own-check | 3815 | 55.68 |
| g3-p55 | generationBoard | pawn-drop-mate | 0 | 0.00 |
| g3-p55 | generationDrop | execute-action | 0 | 0.00 |
| g3-p55 | generationDrop | execute-api | 0 | 0.00 |
| g3-p55 | generationDrop | validation | 18306 | 217.05 |
| g3-p55 | generationDrop | pseudo | 0 | 0.00 |
| g3-p55 | generationDrop | board-setup | 6288 | 67.35 |
| g3-p55 | generationDrop | own-check | 6288 | 97.41 |
| g3-p55 | generationDrop | pawn-drop-mate | 2 | 0.59 |
| g3-p55 | executionBoard | execute-action | 71 | 138.49 |
| g3-p55 | executionBoard | execute-api | 71 | 138.12 |
| g3-p55 | executionBoard | validation | 71 | 46.82 |
| g3-p55 | executionBoard | pseudo | 71 | 0.40 |
| g3-p55 | executionBoard | board-setup | 71 | 44.29 |
| g3-p55 | executionBoard | own-check | 71 | 1.37 |
| g3-p55 | executionBoard | pawn-drop-mate | 0 | 0.00 |
| g3-p55 | executionDrop | execute-action | 181 | 387.57 |
| g3-p55 | executionDrop | execute-api | 181 | 387.20 |
| g3-p55 | executionDrop | validation | 181 | 27.80 |
| g3-p55 | executionDrop | pseudo | 0 | 0.00 |
| g3-p55 | executionDrop | board-setup | 181 | 9.16 |
| g3-p55 | executionDrop | own-check | 181 | 14.78 |
| g3-p55 | executionDrop | pawn-drop-mate | 1 | 0.32 |
| g4-p89 | generationBoard | execute-action | 0 | 0.00 |
| g4-p89 | generationBoard | execute-api | 0 | 0.00 |
| g4-p89 | generationBoard | validation | 2781 | 73.84 |
| g4-p89 | generationBoard | pseudo | 2501 | 6.65 |
| g4-p89 | generationBoard | board-setup | 2781 | 13.39 |
| g4-p89 | generationBoard | own-check | 2781 | 39.81 |
| g4-p89 | generationBoard | pawn-drop-mate | 0 | 0.00 |
| g4-p89 | generationDrop | execute-action | 0 | 0.00 |
| g4-p89 | generationDrop | execute-api | 0 | 0.00 |
| g4-p89 | generationDrop | validation | 20493 | 434.05 |
| g4-p89 | generationDrop | pseudo | 0 | 0.00 |
| g4-p89 | generationDrop | board-setup | 10736 | 114.54 |
| g4-p89 | generationDrop | own-check | 10736 | 161.68 |
| g4-p89 | generationDrop | pawn-drop-mate | 227 | 80.69 |
| g4-p89 | executionBoard | execute-action | 64 | 142.01 |
| g4-p89 | executionBoard | execute-api | 64 | 141.89 |
| g4-p89 | executionBoard | validation | 64 | 46.80 |
| g4-p89 | executionBoard | pseudo | 64 | 0.35 |
| g4-p89 | executionBoard | board-setup | 64 | 44.43 |
| g4-p89 | executionBoard | own-check | 64 | 1.28 |
| g4-p89 | executionBoard | pawn-drop-mate | 0 | 0.00 |
| g4-p89 | executionDrop | execute-action | 207 | 454.78 |
| g4-p89 | executionDrop | execute-api | 207 | 454.35 |
| g4-p89 | executionDrop | validation | 207 | 34.63 |
| g4-p89 | executionDrop | pseudo | 0 | 0.00 |
| g4-p89 | executionDrop | board-setup | 207 | 11.28 |
| g4-p89 | executionDrop | own-check | 207 | 16.89 |
| g4-p89 | executionDrop | pawn-drop-mate | 1 | 0.28 |
| g1-p93 | generationBoard | execute-action | 0 | 0.00 |
| g1-p93 | generationBoard | execute-api | 0 | 0.00 |
| g1-p93 | generationBoard | validation | 7150 | 171.91 |
| g1-p93 | generationBoard | pseudo | 2325 | 6.70 |
| g1-p93 | generationBoard | board-setup | 7150 | 29.99 |
| g1-p93 | generationBoard | own-check | 7150 | 93.23 |
| g1-p93 | generationBoard | pawn-drop-mate | 0 | 0.00 |
| g1-p93 | generationDrop | execute-action | 0 | 0.00 |
| g1-p93 | generationDrop | execute-api | 0 | 0.00 |
| g1-p93 | generationDrop | validation | 47223 | 892.02 |
| g1-p93 | generationDrop | pseudo | 0 | 0.00 |
| g1-p93 | generationDrop | board-setup | 29557 | 291.60 |
| g1-p93 | generationDrop | own-check | 29557 | 392.91 |
| g1-p93 | generationDrop | pawn-drop-mate | 261 | 66.71 |
| g1-p93 | executionBoard | execute-action | 66 | 137.70 |
| g1-p93 | executionBoard | execute-api | 66 | 137.55 |
| g1-p93 | executionBoard | validation | 66 | 44.76 |
| g1-p93 | executionBoard | pseudo | 66 | 0.45 |
| g1-p93 | executionBoard | board-setup | 66 | 42.23 |
| g1-p93 | executionBoard | own-check | 66 | 1.21 |
| g1-p93 | executionBoard | pawn-drop-mate | 0 | 0.00 |
| g1-p93 | executionDrop | execute-action | 249 | 562.08 |
| g1-p93 | executionDrop | execute-api | 249 | 561.31 |
| g1-p93 | executionDrop | validation | 249 | 41.55 |
| g1-p93 | executionDrop | pseudo | 0 | 0.00 |
| g1-p93 | executionDrop | board-setup | 249 | 14.56 |
| g1-p93 | executionDrop | own-check | 249 | 21.06 |
| g1-p93 | executionDrop | pawn-drop-mate | 1 | 0.36 |

executeLegalAction総数・包含時間はexecutionBoard.execute-action＋executionDrop.execute-action。同項目を分けて示す上表から総数を再現できる。生成dropのvalidationは早期棄却を含む全候補で、実行側の合法dropだけとは母集団が異なる。pawn-drop-mateはガードを通った実処理回数（歩打ち全件数ではない）。

| 局面 | execute API包含－validation包含の残余ms（中央値） |
| --- | ---: |
| g1-p115 | 667.08 |
| g3-p55 | 455.06 |
| g4-p89 | 512.86 |
| g1-p93 | 610.27 |

この残余には成り検証、状態構築、履歴/反復・終局確認などを含む。今回その内部を分解しておらず、どれが支配的かは断定しない。

## 診断OFFの通常100ms探索

| 局面 | main→変更後 API中央値ms | main→変更後 completedDepth（各本） | main→変更後 fallback | root候補 |
| --- | ---: | --- | ---: | ---: |
| g1-p115 | 102.08 → 103.65 | 0,0,0,0,0 → 0,0,0,0,0 | 5/5 → 5/5 | 314 |
| g3-p55 | 101.62 → 101.92 | 0,0,0,0,0 → 0,0,0,0,0 | 5/5 → 5/5 | 222 |
| g4-p89 | 102.59 → 101.32 | 0,0,0,0,0 → 0,0,0,0,0 | 5/5 → 5/5 | 249 |
| g1-p93 | 101.94 → 103.16 | 0,0,0,0,0 → 0,0,0,0,0 | 5/5 → 5/5 | 289 |

| 局面 | selectedAction | selectedEvaluation | timedOut（各本） |
| --- | --- | --- | --- |
| g1-p115 | {"kind":"move","player":"sente","from":{"row":0,"col":5},"to":{"row":0,"col":4},"pieceType":"pawn","promotion":"none"} | null | true,true,true,true,true |
| g3-p55 | {"kind":"move","player":"sente","from":{"row":6,"col":4},"to":{"row":5,"col":4},"pieceType":"pawn","promotion":"none"} | null | true,true,true,true,true |
| g4-p89 | {"kind":"move","player":"sente","from":{"row":0,"col":3},"to":{"row":0,"col":2},"pieceType":"pawn","promotion":"none"} | null | true,true,true,true,true |
| g1-p93 | {"kind":"move","player":"sente","from":{"row":1,"col":5},"to":{"row":0,"col":5},"pieceType":"pawn","promotion":"promote"} | null | true,true,true,true,true |

## 固定深さ1の独立OFF系列と監査

| 局面 | main OFF中央値ms | 変更後 OFF中央値ms | 変更後 ON中央値ms |
| --- | ---: | ---: | ---: |
| g1-p115 | 1873.63 | 1895.85 | 2155.72 |
| g3-p55 | 815.61 | 870.23 | 947.29 |
| g4-p89 | 1054.49 | 1012.29 | 1220.48 |
| g1-p93 | 1592.34 | 1630.13 | 1916.74 |

全4局面の合法手配列・順序・全root手の適用後state SHAをmain/OFF/ONで照合。timestampとランダムrecordIdだけ正規化し、盤面・持駒・手番・履歴・終局情報を含める。固定深さ1の全標本で選択手・評価・PV・完了深さ・通常/q訪問数が一致。各探索の入力は凍結Proxyによる書込み監視と前後SHAで非破壊確認。
系列を交互に実行しない。JIT・GC・実行順やOS負荷の差を含むため、OFF/ON時間差を性能改善率に扱わない。100ms探索は制限時間付近で打ち切られるため、固定深さ1とは比較しない。

## 仮説と結論

A: 生成済みboard actionは実行ごとにvalidateMoveで幾何・自玉安全を再確認。B: 生成時にvalidateDrop済みのdropも実行ごとに再検証。C: 実行dropでは盤面準備・自玉王手判定が再実行され、条件付き打ち歩詰めも同経路を通る。実処理0回の項目は発生しなかった事実として扱う。
Dは証明していない。処理回数と診断内の時間比から次PR優先度を判断し、検証を安全に省略できる範囲や通常探索での改善幅は別PRで設計・測定する。
分類: **曖昧（重複は確実、主要な最適化対象と断定するには不足）**。board 287件・drop 909件の全1196実行で再検証率1.00。生成側の直接own-checkは105409回、実行側は1196回（生成回数の1.13%）。診断ON内で再検証の包含中央値は局面ごと74.61〜96.88ms、API比4.21〜7.93%。処理量は存在するが、通常探索における費用対効果をこの時間比だけでA/B断定しない。
実行dropでは全909件で盤面準備・自玉王手判定が発生し、打ち歩詰め処理は局面順に1/1/1/1回（合計4回）。Cは自玉確認について成立する。生成側の打ち歩詰めは286/2/227/261回。静止探索でのdrop実行は合計0件。生成と探索実行の母集団の差が大きい。
次PR候補: 生成済みLegalAction専用の内部適用経路は検討対象に残すが、今回の数字だけで最優先とはしない。先にexecuteMove/executeDropの検証後の状態構築・履歴/反復・終局確認の残余、または静止探索で生成されたdropが未実行になる処理量を診断する。公開APIの安全性と内部経路の設計・高速化は別PR。このPRで検証省略・キャッシュは実装しない。

再実行（各コマンドは別プロセス）:

```powershell
npm run measure:action-revalidation -- timed docs/benchmarks/別名-timed.jsonl
npm run measure:action-revalidation -- fixed-off docs/benchmarks/別名-off.jsonl
npm run measure:action-revalidation -- fixed-on docs/benchmarks/別名-on.jsonl
npm run audit:action-revalidation -- TIMED OFF ON BASELINE_TIMED BASELINE_OFF REPORT.md
```

baselineはmainの別worktreeへ同じ測定スクリプトのみコピーしtimed/fixed-offを実行。既存ファイルはwxで上書きしない。
生データ: `docs/benchmarks/action-revalidation-timed-20261009.jsonl`、`docs/benchmarks/action-revalidation-fixed-off-20261009.jsonl`、`docs/benchmarks/action-revalidation-fixed-on-20261009.jsonl`、`docs/benchmarks/action-revalidation-main-timed-20261009.jsonl`、`docs/benchmarks/action-revalidation-main-fixed-20261009.jsonl`。

## 検証結果

- `npm run check`: lockfile・型検査・64ファイル1,756テスト・production build成功（終了コード0）。新規4テストも単独実行成功。
- 新比較監査: 5独立系列・140標本、4局面の合法手順序・全root手の適用後state、固定深さ1の選択手・評価・PV・深さ・訪問数・入力非破壊・回数/包含時間/合計関係を確認。
- 既存`audit:check-internals`、`audit:q-legal-breakdown`、`audit:check-shortcircuit`成功。`git diff --check`成功。

ローカルWindowsサンドボックスではnative realpathと一時ファイルrenameがEPERMとなったため、テスト起動時だけ標準realpathへのEPERM時fallbackとworkspace内TEMP/TMPを使用した。標準設定および1 thread workerでは既存quiescence-ordering-repeatedの同期大量assertionテストが5秒を超え、そこで中断した。最終全チェックはローカルpreloadからVitestへ`--pool=forks --maxWorkers=1 --testTimeout=30000`を渡した。テスト本体・アサーション・リポジトリの設定は変更していない。標準5秒制限でのローカル全チェック完走は未確認で、CIの通常設定で確認する。テスト用preloadはPRに含めず、測定には使用していない。

計測時はmainへ未コミットの診断差分を適用した状態（生データのdirty=true）。実行した診断コード・測定器をコミット`4bdde0a`に保存し、後続コミットは監査の資料出力とLOG・生データを追加する。
