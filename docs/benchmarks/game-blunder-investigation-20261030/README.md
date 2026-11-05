# 悪手診断 v3：期限と固定条件の比較

## 結論

先行v3の24件はすべて`completed-iteration`、深さ1が13件・深さ2が11件だったが、最大深さ4を完了する前に期限が来たため`timedOut=true`となった。v3判定器はこのフラグだけで完了済み反復も比較から除外した。完了済み反復と中断した次の反復は異なる。今回の詳細診断で再実行した24件もすべて期限到達だったが、20件は深さ1、4件は深さ2を完了した。再実行は異なる時刻・診断ONの観測であり旧runの停止箇所を直接測ったものではない。未完了反復やpartial-rootは正式な評価にしない。

詳細診断ONでの期限検知箇所はquiescence 15、normal-other 9。stageはbefore-quiescence-candidate 12、after-quiescence-action 3、quiescence-entry 8、normal-node-entry 1。これらは検知時点であり、期限をまたいだ処理や根本原因と同一ではない。各局面のdeadline観測・phase・候補数・統計・時間はobservations.jsonlを参照。24回の探索呼出し合計約24,097ms、外部合法手生成約32ms、内部root合法手生成約22ms。診断phaseは排他的区分で、quiescence本体に加えてq-*の合法手生成・適用・評価を個別に数える。記録と正規化の細かな時間、およびjournal読取と復元を別々には計測していない。監査・復元を合わせた前処理約30,051msは探索期限外。計測ON/OFFの負荷差は未測定で、時間比較や高速化の根拠にはしない。

## 固定条件：旧疑い4局面

元の局面、旧実手と旧代替手を既存合法手一覧で照合。固定root手診断により、評価は元手番視点。通常深さ2、standard ordering、TT/PV/killer OFF、静止探索0または1、上限1500 trace enter（通常+静止、root自体は含まない）、各呼出し3秒の協調上限。0と1の差は静止探索深さのみ。各候補・各条件を2回、計32回すべて完了し、手・評価・PV・深さ・観測ノード数・停止理由が16組すべて一致。時間は一致項目に含めない。制限はノードentryで検査し、1つの同期合法手生成などを途中で止められない。全探索枝の完全性は、指定された有限の深さと静止探索設定内のもので、勝敗や最善手の証明ではない。

| journal / ply | q0 実手 | q0 代替 | q1 実手 | q1 代替 | q0 → q1 の代替優位差 |
|---|---:|---:|---:|---:|---:|
| hirate-1 / 9 | -178 | -710 | 23 | 543 | -532 → 520 |
| hirate-1 / 20 | -600 | -720 | 102 | 480.67 | -120 → 378.67 |
| hirate-2 / 36 | -610 | -928 | -610 | 699 | -318 → 1309 |
| hirate-1 / 31 | 401 | 205 | 516 | 1237 | -196 → 721 |

実手後の合法応手は順に34、43、2、5手、代替手後は37、38、41、64手。実手後に移動先への合法捕獲は順に1、1、2、3手。王手中の2局面は合法な王手応手のみを列挙する。元の実戦交換追跡はv3のJSONにあり、別分岐や捨て駒の補償は網羅していない。各手、全合法応手、PV、完了統計は生JSONLに保存。q0/q1で差の方向が変わったことは**静止探索条件が有限探索値に影響した観測**であり、静止探索が実戦の悪手を起こした因果証明ではない。有限差だけではCONFIRMEDを出さない。v3の判定を遡って書き換えない。

## その他の原因候補と分類

SEE・手の並べ替え、通常深さ、評価関数、時間予算は今回単独比較せずUNKNOWN。SEEはstandard orderingで無効、既存SEEの合法取り返し実装を重複させない。勝敗証明は強制勝敗の限定検証であり、通常中盤のunknownを不具合扱いしない。改善優先順位は、原因確定と実戦上の損失が未証明のためNOT_READY。次は同一4局面の深さ3と独立した交換分岐、q候補・打切りの差を上限付きで比べる。

56件のv3分類を再集計：A/B/C/D/E/F = 21/1/3/1/0/11、複数特徴11、特徴なし30（UNKNOWN）、INDETERMINATE 24、NOT_RUN 32。特徴は悪手の確定数ではない。

## 来歴・再現

基準commit `b244f4c8a5c02300343ab7f9d6c861c1f656588d`。探索エンジンや既定値の変更なし。固定条件は診断用SearchDiagnosticsと既存固定深さAPIを使う。TTとPV再利用を無効にし、固定の合法手順、候補順、設定、独立呼出しを使う。乱数・共有探索キャッシュは使用しない。4 journalの分析前後SHA256はJSONLのplan/endにあり全一致。非有限値はJSON内でタグ化し、有限差として計算しない。

```powershell
node --import tsx scripts/diagnose-blunder-investigation.ts NEW_DIR docs/benchmarks/game-blunder-pilot-balanced-20261029/candidates.json docs/benchmarks/game-blunder-rediagnosis-v3-20261030/diagnosis.json docs/benchmarks/match-journal-20261026/run1/hirate-1.jsonl docs/benchmarks/match-journal-20261026/run1/hirate-2.jsonl docs/benchmarks/match-journal-20261026/run1/replay-1.jsonl docs/benchmarks/match-journal-20261026/run1/replay-2.jsonl
node --import tsx scripts/summarize-blunder-investigation.ts NEW_DIR
```

新規出力ディレクトリを要求し、1呼出しごとにJSONLへ追記する。24局面×1秒、旧4局面×2候補×2条件×2反復、実験全体180秒のソフト上限。途中停止は未完了として記録する。`summary.json`はJSONLから再集計される。測定時の診断コードhashはplanに記録。測定後に非有限値の比較キーを明示タグ化する修正を行ったが、本実験32呼出しの評価はすべて有限であり保存済み結果には影響しない。
