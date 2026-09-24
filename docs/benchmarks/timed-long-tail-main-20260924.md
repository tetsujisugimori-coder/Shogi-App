# 100ms探索の長い尾

コード 479a13938a925701a6eba73f449d51940fdfc545、dirty=false、Node v24.20.0、win32 10.0.26200 x64、Intel(R) Core(TM) i7-14650HX。
同期直列4局、最大120手、保存棋譜3局面のOFF/ON各2ウォームアップ・5本測定。対局診断on。
API内実時間は探索内の開始時計から返却直前の時計まで。呼び出し全体は呼出直前から戻り直後まで。api-otherはAPI内時間から排他的工程を差し引く。旧PR #156の保存値は戻り後の診断終了まで含むため比較時は旧定義として扱う。
本測定510件、fallback 481件、100ms超510件、105ms超368件。最大超過 {"id":"g1-p115","milliseconds":333.803899999999}。
最長期限確認間隔 {"id":"g1-p93","milliseconds":415.5600000000013,"phase":"root-legal"}。root内部の最長同期処理 {"id":"g3-p117","phase":"root-hand-drops","milliseconds":97.16560000000754,"calls":4}。静止探索内部の最長同期処理 {"id":"g3-p40","phase":"q-legal","milliseconds":40.66349999999511,"calls":1}。
GC観測228イベント、探索時間と重複228件、GC欠測0件。重複は因果関係を示さない。ヒープ欠測0件。最初と最後のサンプル {"at":581.3166,"bytes":36965568} → {"at":117947.6259,"bytes":159849208}。これらは処理中の最大値ではない。
保存棋譜局面の診断OFF/ON対応差（ON-OFF、ms）: {"count":15,"medianDeltaMilliseconds":-0.6412000000127591,"minDeltaMilliseconds":-47.18639999999141,"maxDeltaMilliseconds":19.826499999995576,"actionChanged":0,"depthChanged":0}。単一順序の反復なので計測負荷だけを分離できない。

| 局面 | 由来 | 診断 | 実時間ms | API内ms | 超過ms | 深さ | GC重複 | 前後heap bytes |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| g1-p115 | fallback | OFF | 433.80 | 433.77 | 333.80 | 0 | 1 | 156024920 → 119811152 |
| g1-p93 | fallback | ON | 415.78 | 415.72 | 315.78 | 0 | 0 | 130739680 → 157824776 |
| g1-p115 | fallback | ON | 411.96 | 411.92 | 311.96 | 0 | 0 | 131328952 → 160280568 |
| g1-p107 | fallback | ON | 407.28 | 407.22 | 307.28 | 0 | 1 | 171229376 → 134735040 |
| g1-p115 | fallback | OFF | 400.25 | 400.21 | 300.25 | 0 | 1 | 178586456 → 142329720 |
| g3-p117 | fallback | ON | 397.57 | 397.50 | 297.57 | 0 | 0 | 122391160 → 147216984 |
| g1-p109 | fallback | ON | 397.41 | 397.35 | 297.41 | 0 | 0 | 115451680 → 143003096 |
| g1-p115 | fallback | ON | 391.51 | 391.47 | 291.51 | 0 | 0 | 130898912 → 159849208 |
| g2-p89 | fallback | ON | 378.16 | 378.11 | 278.16 | 0 | 0 | 61882056 → 86046784 |
| g1-p115 | fallback | OFF | 371.69 | 371.65 | 271.69 | 0 | 0 | 153847520 → 182786696 |

対局別ヒープ前後: 1: 36965568 → 160058552 bytes、2: 165620304 → 98711320 bytes、3: 103369824 → 118560168 bytes、4: 123120224 → 105359288 bytes。
GC重複例（時刻はperformance時間軸のms）: [{"id":"g1-p1","start":585.5779,"duration":0.36229997873306274,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":599.3732,"duration":0.302700012922287,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":612.2752,"duration":0.16200000047683716,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":623.3429,"duration":0.19120001792907715,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":631.3759,"duration":0.2136000096797943,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":641.08,"duration":0.19510000944137573,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":649.0988,"duration":0.2510000169277191,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":657.0316,"duration":0.37119999527931213,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":666.6691,"duration":0.4178999960422516,"kind":1,"flags":0,"overlapsSearch":true},{"id":"g1-p1","start":677.8085,"duration":0.3955000042915344,"kind":1,"flags":0,"overlapsSearch":true}]。
保存棋譜局面は同一局面を反復する対応測定。診断時計読みと処理区分の追加により結果と時間は変わり得る。手数打切は勝敗・棋力の証拠ではない。
