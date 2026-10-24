# 非捕獲成りq比較（保存rawから再集計）

基準main 376bcbabed2309d017b233b4a264504007f70db7。10局面・最大通常深さ4・q1/original・evasion追加0・標準評価。各cell warmup1/本3、before/onはAB/BA交代、直列、計測中は診断OFF。固定d1ではoffも測定。
通常/qノードは最後の完了反復。totalは完了反復合計で、中断分を含まない。実時間は中断作業を含む。SEE callsは別の診断付きd2の並べ替えバッチ数で、時限測定のSEE個別捕獲数ではない。

|順序|予算|条件|n|実時間合計ms|最大超過ms|完了深さ合計|通常/q（最終）|通常/q（完了合計）|
|---|---|---|---:|---:|---:|---:|---|---|
|standard|d1|before|30|94.757|N/A|N/A|369/81|N/A/N/A|
|standard|d1|on|30|141.292|N/A|N/A|369/282|N/A/N/A|
|standard|100|before|30|2669.076|0.963|86|10854/1976|13722/2484|
|standard|100|on|30|2801.981|2.573|75|8037/3543|10794/5076|
|standard|1000|before|30|15079.806|1.591|108|57345/17376|67845/19506|
|standard|1000|on|30|17057.711|0.850|107|48755/31188|59547/40514|
|static-exchange|d1|before|30|131.215|N/A|N/A|369/81|N/A/N/A|
|static-exchange|d1|on|30|176.950|N/A|N/A|369/282|N/A/N/A|
|static-exchange|100|before|30|2686.127|1.130|81|11679/1725|14451/2214|
|static-exchange|100|on|30|2805.605|0.727|72|7773/3375|10440/4908|
|static-exchange|1000|before|30|15245.331|1.034|104|45370/12630|54365/14244|
|static-exchange|1000|on|30|16326.843|1.272|103|36235/27975|45871/34661|

|順序|予算|深さ改善/悪化/同じ（対数）|選択手変化|
|---|---|---|---:|
|standard|d1|0/0/30|12|
|standard|100|0/11/19|5|
|standard|1000|0/1/29|4|
|static-exchange|d1|0/0/30|12|
|static-exchange|100|0/9/21|6|
|static-exchange|1000|1/2/27|5|

## 局面別（3本の中央値、最大超過は3本の最大）

|局面|順序|予算|実ms 前→後|完了深さ 前→後|最大超過 前→後|
|---|---|---|---|---|---|
|initial|standard|100|100.112→100.131|2→2|0.229→0.199|
|initial|standard|1000|1000.630→1000.739|2→2|1.591→0.767|
|initial|static-exchange|100|100.381→100.476|1→1|0.502→0.493|
|initial|static-exchange|1000|1000.581→1000.506|2→2|1.014→1.272|
|pawn-recapture|standard|100|100.461→101.928|3→3|0.642→2.573|
|pawn-recapture|standard|1000|122.844→250.961|4→4|-867.671→-174.654|
|pawn-recapture|static-exchange|100|100.107→100.114|3→3|0.109→0.121|
|pawn-recapture|static-exchange|1000|102.089→202.657|4→4|-887.852→-793.140|
|poisoned-rook|standard|100|100.101→100.115|3→3|0.103→0.148|
|poisoned-rook|standard|1000|118.677→249.560|4→4|-873.851→-747.533|
|poisoned-rook|static-exchange|100|100.141→100.097|3→3|0.184→0.126|
|poisoned-rook|static-exchange|1000|122.633→248.162|4→4|-862.863→-738.121|
|rook-check|standard|100|41.030→52.978|4→4|-58.306→-43.715|
|rook-check|standard|1000|40.811→59.570|4→4|-954.909→-939.084|
|rook-check|static-exchange|100|46.304→61.670|4→4|-51.971→-37.665|
|rook-check|static-exchange|1000|39.097→52.410|4→4|-960.373→-947.031|
|promotion-capture|standard|100|45.498→76.976|4→4|-53.002→-20.848|
|promotion-capture|standard|1000|49.227→80.190|4→4|-949.176→-917.998|
|promotion-capture|static-exchange|100|46.291→71.570|4→4|-52.781→-27.987|
|promotion-capture|static-exchange|1000|46.274→71.314|4→4|-953.529→-924.942|
|gold-drop-evasion|standard|100|100.140→100.109|3→2|0.142→0.128|
|gold-drop-evasion|standard|1000|772.097→829.657|4→4|-224.620→0.119|
|gold-drop-evasion|static-exchange|100|100.112→100.102|3→2|0.124→0.125|
|gold-drop-evasion|static-exchange|1000|793.766→1000.490|4→3|0.375→0.521|
|exchange-chain|standard|100|100.555→100.516|2→2|0.885→0.641|
|exchange-chain|standard|1000|1000.414→1000.728|3→3|0.425→0.850|
|exchange-chain|static-exchange|100|100.485→100.498|2→2|0.600→0.727|
|exchange-chain|static-exchange|1000|1000.548→1000.370|3→3|1.034→0.407|
|evasion-promotion|standard|100|100.420→100.425|3→2|0.451→0.475|
|evasion-promotion|standard|1000|314.609→432.719|4→4|-684.601→-563.414|
|evasion-promotion|static-exchange|100|100.503→100.501|3→2|1.130→0.523|
|evasion-promotion|static-exchange|1000|300.943→409.176|4→4|-680.950→-582.243|
|evasion-promotion-gote|standard|100|100.907→100.467|3→2|0.963→0.476|
|evasion-promotion-gote|standard|1000|616.026→557.858|4→4|-381.013→-411.740|
|evasion-promotion-gote|static-exchange|100|100.383→100.393|3→2|0.458→0.581|
|evasion-promotion-gote|static-exchange|1000|616.518→537.633|4→4|-381.465→-445.604|
|see-deadline|standard|100|100.505→100.365|2→1|0.609→0.540|
|see-deadline|standard|1000|1000.406→1000.427|3→3|0.621→0.481|
|see-deadline|static-exchange|100|100.452→100.579|1→1|0.467→0.581|
|see-deadline|static-exchange|1000|1000.711→1000.509|2→2|0.906→1.078|

固定・時限の選択手/評価/PV/内訳/全統計はraw.jsonlへ完全保存。時間差・深さ差はOS/JIT/GCの影響を含み、対局全体の棋力向上や厳密期限の保証とはしない。
