# 同一時間比較のUI／通信fixture

`time-limited-quiescence-comparison-results.json` は初期局面、既存UIテストの4手進行局面、`comparisonCaptureTrap(true)`、`comparisonExtendedPv()`について、実際の `analyzeTimeLimitedQuiescenceComparison(state, 4, 1000, () => 0)` から作成した。

UIで異なる完了深さを決定的に扱うため、各設定の完了反復を3／2／4まで保持し、最深結果・合計統計・completedDepth・timedOutをその完了反復に合わせた。経過時間は偽clockの0であり、実際の1秒で到達する深さ・性能を示すデータではない。各反復の推奨手・評価・PV・通常／静止探索統計は実探索の値を保持する。UI／Workerテストではアプリケーションvalidatorで全件検証してから使う。

`time-limited-comparison-presets.json` は初期局面に対する `analyzeEvaluationPresetComparison(state, 3, () => 0)` の実結果。新しい比較の開始・中止・成功で既存の比較表示が保持されることを検証する。

探索本体との接続・条件ごとの時計の初期化はドメイン／handlerテストで別途確認する。UIテストで実探索を繰り返さず、実時間・固定待機・速度の閾値を合否条件にしない。
