# 駒安全度の保存原本からの再集計

基準 e2f12e97f2d2c297b3b2ac5648bbfb12dc53faad。A=legacy / B=experimental。全28局面、warmup1＋本3、q1/original、通常standard、TT/PV/killer OFF。

全体未完了：取得 1012/1013、欠測 1。旧mainとの互換 28局面（d1全結果およびTT d2全結果/統計）。

|条件|方式|本数|API合計ms|最大超過ms|深さ合計|採用反復 通常/qノード|partial/fallback|
|---|---|---:|---:|---:|---:|---|---|
|d1|A|84|810.421|0.000|84|1548/489|0/0|
|d1|B|84|778.463|0.000|84|1548/474|0/0|
|d3|A|84|42843.304|0.000|252|74850/9666|0/0|
|d3|B|84|47640.232|0.000|252|81933/8811|0/0|
|100ms|A|84|8192.098|4.212|198|10168/2139|0/0|
|100ms|B|84|8146.338|4.028|198|10193/2032|0/0|
|1000ms|A|84|57781.235|4.470|291|62672/10378|0/0|
|1000ms|B|84|56758.626|4.012|293|64440/9487|0/0|

反復全体の完了作業（中断反復の未完了作業を含まない）:
- d1/A: 通常 1548 / q 489
- d1/B: 通常 1548 / q 474
- d3/A: 通常 74850 / q 9666
- d3/B: 通常 81933 / q 8811
- 100ms/A: 通常 14912 / q 3191
- 100ms/B: 通常 15243 / q 3073
- 1000ms/A: 通常 84776 / q 14317
- 1000ms/B: 通常 87459 / q 13607

|条件|選択手変化|深さ改善/悪化|有限参照better/worse/equal/不足|
|---|---:|---|---|
|d1|15/84|0/0|3/0/42/39|
|d3|0/84|0/0|0/0/45/39|
|100ms|6/84|1/1|0/0/45/39|
|1000ms|1/84|4/2|0/0/45/39|

深さ差は性能指標。有限参照のbetter/worseは同じ旧評価のd3全幅/正逆参照による候補比較で、実戦勝敗や一般棋力の証明ではない。参照のルール・静的評価を製品と共有する制約がある。

|条件|方式|ProvenError|QualityGap|Inconclusive|NoObservedDifference|
|---|---|---:|---:|---:|---:|
|d1|A|0|15|39|30|
|d1|B|0|15|39|30|
|d3|A|0|0|39|45|
|d3|B|0|0|39|45|
|100ms|A|0|3|39|42|
|100ms|B|0|3|39|42|
|1000ms|A|0|0|39|45|
|1000ms|B|0|0|39|45|

|ms|B勝|B負|規則引分|120ply打切り|失敗|未保存/未完了|総ply|B先手勝/後手勝|
|---|---:|---:|---:|---:|---:|---:|---:|---|
|100|1|1|1|3|0|0|446|0/1|
|1000|0|0|0|2|0|2|240|0/0|

保存済み8局の全棋譜・各手PV・内訳・最終局面・終局理由はrun2/raw.jsonlで監査。親停止したペアの途中棋譜は未保存で監査対象外。少数対局から一般棋力は断定しない。

診断ON（主性能表とは別。異なるleaf集合なので一回当たりを直接の同一仕事比較にしない）:
- A: 評価 679回 / 65.513ms
- B: 評価 674回 / 64.153ms

## 改善と悪化の例（各方向最大6件、全件はreport.json）

{"id":"poisoned-rook","condition":"d1","run":1,"direction":"better","a":{"action":{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":5,"col":7},"pieceType":"rook","promotion":"none"},"value":{"breakdown":{"total":589,"material":700,"pieceSquare":-5,"kingSafety":14,"undefendedPieceSafety":-120,"terminal":null},"pv":[{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":5,"col":7},"pieceType":"rook","promotion":"none"},{"kind":"move","player":"gote","from":{"row":0,"col":8},"to":{"row":1,"col":8},"pieceType":"king","promotion":"none"},{"kind":"move","player":"sente","from":{"row":5,"col":7},"to":{"row":1,"col":7},"pieceType":"rook","promotion":"promote"}],"terminalDistancePly":null,"reason":null},"closed":false},"b":{"action":{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":6,"col":4},"pieceType":"rook","promotion":"none"},"value":{"breakdown":{"total":640,"material":700,"pieceSquare":0,"kingSafety":0,"undefendedPieceSafety":-60,"terminal":null},"pv":[{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":6,"col":4},"pieceType":"rook","promotion":"none"},{"kind":"move","player":"gote","from":{"row":0,"col":8},"to":{"row":0,"col":7},"pieceType":"king","promotion":"none"},{"kind":"move","player":"sente","from":{"row":6,"col":4},"to":{"row":4,"col":4},"pieceType":"rook","promotion":"none"}],"terminalDistancePly":null,"reason":null},"closed":false}}
{"id":"poisoned-rook","condition":"d1","run":2,"direction":"better","a":{"action":{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":5,"col":7},"pieceType":"rook","promotion":"none"},"value":{"breakdown":{"total":589,"material":700,"pieceSquare":-5,"kingSafety":14,"undefendedPieceSafety":-120,"terminal":null},"pv":[{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":5,"col":7},"pieceType":"rook","promotion":"none"},{"kind":"move","player":"gote","from":{"row":0,"col":8},"to":{"row":1,"col":8},"pieceType":"king","promotion":"none"},{"kind":"move","player":"sente","from":{"row":5,"col":7},"to":{"row":1,"col":7},"pieceType":"rook","promotion":"promote"}],"terminalDistancePly":null,"reason":null},"closed":false},"b":{"action":{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":6,"col":4},"pieceType":"rook","promotion":"none"},"value":{"breakdown":{"total":640,"material":700,"pieceSquare":0,"kingSafety":0,"undefendedPieceSafety":-60,"terminal":null},"pv":[{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":6,"col":4},"pieceType":"rook","promotion":"none"},{"kind":"move","player":"gote","from":{"row":0,"col":8},"to":{"row":0,"col":7},"pieceType":"king","promotion":"none"},{"kind":"move","player":"sente","from":{"row":6,"col":4},"to":{"row":4,"col":4},"pieceType":"rook","promotion":"none"}],"terminalDistancePly":null,"reason":null},"closed":false}}
{"id":"poisoned-rook","condition":"d1","run":3,"direction":"better","a":{"action":{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":5,"col":7},"pieceType":"rook","promotion":"none"},"value":{"breakdown":{"total":589,"material":700,"pieceSquare":-5,"kingSafety":14,"undefendedPieceSafety":-120,"terminal":null},"pv":[{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":5,"col":7},"pieceType":"rook","promotion":"none"},{"kind":"move","player":"gote","from":{"row":0,"col":8},"to":{"row":1,"col":8},"pieceType":"king","promotion":"none"},{"kind":"move","player":"sente","from":{"row":5,"col":7},"to":{"row":1,"col":7},"pieceType":"rook","promotion":"promote"}],"terminalDistancePly":null,"reason":null},"closed":false},"b":{"action":{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":6,"col":4},"pieceType":"rook","promotion":"none"},"value":{"breakdown":{"total":640,"material":700,"pieceSquare":0,"kingSafety":0,"undefendedPieceSafety":-60,"terminal":null},"pv":[{"kind":"move","player":"sente","from":{"row":5,"col":4},"to":{"row":6,"col":4},"pieceType":"rook","promotion":"none"},{"kind":"move","player":"gote","from":{"row":0,"col":8},"to":{"row":0,"col":7},"pieceType":"king","promotion":"none"},{"kind":"move","player":"sente","from":{"row":6,"col":4},"to":{"row":4,"col":4},"pieceType":"rook","promotion":"none"}],"terminalDistancePly":null,"reason":null},"closed":false}}

## 対局別

{"task":{"stage":"match","id":"hirate","limit":100,"maxPlies":120},"summary":{"aWins":0,"bWins":0,"draws":1,"maxPlies":1,"failures":0},"games":[{"outcome":"draw","status":"ended","plies":66},{"outcome":"max_plies","status":"max_plies","plies":120}]}
{"task":{"stage":"match","id":"replay","limit":100,"maxPlies":120},"summary":{"aWins":0,"bWins":0,"draws":0,"maxPlies":2,"failures":0},"games":[{"outcome":"max_plies","status":"max_plies","plies":120},{"outcome":"max_plies","status":"max_plies","plies":120}]}
{"task":{"stage":"match","id":"evasion","limit":100,"maxPlies":120},"summary":{"aWins":1,"bWins":1,"draws":0,"maxPlies":0,"failures":0},"games":[{"outcome":"b_win","status":"ended","plies":10},{"outcome":"a_win","status":"ended","plies":10}]}
{"task":{"stage":"match","id":"hirate","limit":1000,"maxPlies":120},"summary":{"aWins":0,"bWins":0,"draws":0,"maxPlies":2,"failures":0},"games":[{"outcome":"max_plies","status":"max_plies","plies":120},{"outcome":"max_plies","status":"max_plies","plies":120}]}
