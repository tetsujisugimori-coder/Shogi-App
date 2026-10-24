# 保存rawから再集計したA/B/C比較

基準 0dd33ebe9791b2e14abdbbf6ae549c1257d97041。C1はmaxCandidates=1、計測前固定。全360 performance呼出し。

|段階|条件|方式|n|API合計ms|最大超過ms|深さ合計|通常/qノード|対象/追加候補|選別ms|
|---|---|---|---:|---:|---:|---:|---|---|---:|
|pilot|d1|C1|10|44.131|0.000|10|123/56|別診断参照|別診断参照|
|pilot|d1|C2|10|46.259|0.000|10|123/75|別診断参照|別診断参照|
|pilot|d1|C4|10|48.967|0.000|10|123/91|別診断参照|別診断参照|
|pilot|100ms|C1|10|952.104|0.508|23|1956/518|別診断参照|別診断参照|
|pilot|100ms|C2|10|955.810|0.744|24|2000/650|別診断参照|別診断参照|
|pilot|100ms|C4|10|964.582|0.704|24|2389/552|別診断参照|別診断参照|
|performance|d1|A|10|52.132|0.000|10|123/27|別診断参照|別診断参照|
|performance|d1|B|10|64.240|0.000|10|123/94|別診断参照|別診断参照|
|performance|d1|C1|10|57.639|0.000|10|123/56|別診断参照|別診断参照|
|performance|d4|A|10|29895.426|0.000|40|41065/30033|別診断参照|別診断参照|
|performance|d4|B|10|33153.460|0.000|40|42440/45138|別診断参照|別診断参照|
|performance|d4|C1|10|32373.662|0.000|40|41366/33328|別診断参照|別診断参照|
|performance|100ms|A|30|3016.675|2.457|67|2319/660|別診断参照|別診断参照|
|performance|100ms|B|30|3016.950|1.437|56|1443/1382|別診断参照|別診断参照|
|performance|100ms|C1|30|3015.673|2.192|59|1644/1245|別診断参照|別診断参照|
|performance|1000ms|A|30|21458.300|3.418|105|31002/3000|別診断参照|別診断参照|
|performance|1000ms|B|30|23201.342|1.369|97|19872/8087|別診断参照|別診断参照|
|performance|1000ms|C1|30|22287.380|1.837|98|21513/8047|別診断参照|別診断参照|
|diagnostic|d1|A|10|116.269|0.000|10|123/27|124/0|0.000|
|diagnostic|d1|B|10|119.095|0.000|10|123/94|124/124|0.000|
|diagnostic|d1|C1|10|116.678|0.000|10|123/56|124/41|2.348|
|diagnostic|100ms|A|10|1005.916|0.874|19|560/127|1002/0|0.000|
|diagnostic|100ms|B|10|1005.435|1.481|18|385/363|755/755|0.000|
|diagnostic|100ms|C1|10|1007.457|1.245|18|380/248|884/273|27.835|
|diagnostic|1000ms|A|10|8328.260|1.554|32|6715/1068|8120/0|0.000|
|diagnostic|1000ms|B|10|8527.084|0.973|31|4952/1625|8762/8762|0.000|
|diagnostic|1000ms|C1|10|8335.750|1.220|31|4952/1097|8477/3096|237.650|

|ms|方式|A比 深さ改善/悪化/同じ|
|---|---|---|
|100|B|1/12/17|
|100|C1|0/8/22|
|1000|B|0/8/22|
|1000|C1|0/7/23|

対局: A=OFF、B参加者=選択C1。規則上の引分とmax_plies打切りは別。

{"id":"hirate","limit":100,"summary":{"aWins":0,"bWins":0,"draws":1,"maxPlies":1,"failures":0},"games":[{"outcome":"max_plies","status":"max_plies","plies":120,"result":null},{"outcome":"draw","status":"ended","plies":61,"result":{"winner":null,"loser":null,"endReason":"repetition","details":"千日手による無勝負"}}]}
{"id":"hirate-exchange","limit":100,"summary":{"aWins":0,"bWins":1,"draws":1,"maxPlies":0,"failures":0},"games":[{"outcome":"draw","status":"ended","plies":48,"result":{"winner":null,"loser":null,"endReason":"repetition","details":"千日手による無勝負"}},{"outcome":"b_win","status":"ended","plies":45,"result":{"winner":"sente","loser":"gote","endReason":"checkmate"}}]}
{"id":"evasion","limit":100,"summary":{"aWins":1,"bWins":1,"draws":0,"maxPlies":0,"failures":0},"games":[{"outcome":"b_win","status":"ended","plies":14,"result":{"winner":"gote","loser":"sente","endReason":"no_legal_actions"}},{"outcome":"a_win","status":"ended","plies":14,"result":{"winner":"gote","loser":"sente","endReason":"no_legal_actions"}}]}
{"id":"hirate","limit":1000,"summary":{"aWins":1,"bWins":1,"draws":0,"maxPlies":0,"failures":0},"games":[{"outcome":"b_win","status":"ended","plies":44,"result":{"winner":"gote","loser":"sente","endReason":"checkmate"}},{"outcome":"a_win","status":"ended","plies":44,"result":{"winner":"gote","loser":"sente","endReason":"checkmate"}}]}
{"id":"evasion","limit":1000,"summary":{"aWins":1,"bWins":1,"draws":0,"maxPlies":0,"failures":0},"games":[{"outcome":"b_win","status":"ended","plies":16,"result":{"winner":"gote","loser":"sente","endReason":"no_legal_actions"}},{"outcome":"a_win","status":"ended","plies":50,"result":{"winner":"gote","loser":"sente","endReason":"no_legal_actions"}}]}

品質（有限参照・勝敗証明と別）:

{"id":"mate-sente","stopped":true,"classes":[["A","Inconclusive"],["B","Inconclusive"],["C1","Inconclusive"]]}
{"id":"mate-gote","stopped":true,"classes":[["A","Inconclusive"],["B","Inconclusive"],["C1","Inconclusive"]]}
{"id":"mate-three","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"mixed-distance","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"resistance","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"evasion","stopped":false,"classes":[["A","QualityGap"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"recapture","stopped":true,"classes":[["A","Inconclusive"],["B","Inconclusive"],["C1","Inconclusive"]]}
{"id":"capture","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"recapture-gote","stopped":true,"classes":[["A","Inconclusive"],["B","Inconclusive"],["C1","Inconclusive"]]}
{"id":"hirate-exchange","stopped":true,"classes":[["A","Inconclusive"],["B","Inconclusive"],["C1","Inconclusive"]]}
{"id":"countercheck","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"countercheck-gote","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"single-evasion","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"single-evasion-gote","stopped":false,"classes":[["A","NoObservedDifference"],["B","NoObservedDifference"],["C1","NoObservedDifference"]]}
{"id":"hirate-followup-1","stopped":true,"classes":[["A","Inconclusive"],["B","Inconclusive"],["C1","Inconclusive"]]}
{"id":"hirate-followup-2","stopped":true,"classes":[["A","Inconclusive"],["B","Inconclusive"],["C1","Inconclusive"]]}
