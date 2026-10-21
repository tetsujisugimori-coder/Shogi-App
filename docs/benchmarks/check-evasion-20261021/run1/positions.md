# Position comparison (0-based row,col)

|position|d4 selected action (A/B/C identical)|d4 score A / B / C|reference verdict A/B/C|d4 wall ms A / B / C|
|---|---|---|---|---|
|mate-sente|gold (2,3)→(1,4) none|Infinity / Infinity / Infinity|match / match / match|1242.801 / 1303.832 / 1296.407|
|mate-gote|rook (6,4)→(7,4) decline|Infinity / Infinity / Infinity|match / match / match|1384.236 / 1485.797 / 1546.170|
|mate-three|gold (3,0)→(2,0) none|Infinity / Infinity / Infinity|match / match / match|13.552 / 14.289 / 13.579|
|mixed-distance|gold (2,0)→(1,0) none|Infinity / Infinity / Infinity|match / match / match|19.873 / 20.540 / 20.691|
|resistance|king (0,1)→(0,0) none|-Infinity / -Infinity / -Infinity|indeterminate / indeterminate / indeterminate|25.078 / 25.155 / 25.454|
|evasion|king (8,4)→(7,3) none|-1205 / -1205 / -1205|indeterminate / indeterminate / indeterminate|66.844 / 67.055 / 68.102|
|recapture|rook (5,4)→(5,5) none|599 / 599 / 599|match / match / match|295.707 / 284.379 / 280.746|
|capture|rook (5,4)→(4,4) none|1304 / 1304 / 1304|match / match / match|70.131 / 69.482 / 68.517|
|recapture-gote|rook (3,4)→(3,3) none|599 / 599 / 599|match / match / match|193.103 / 181.424 / 183.614|
|hirate-exchange|lance (4,0)→(0,0) promote|1010 / 1000 / 1000|indeterminate / indeterminate / indeterminate|2967.879 / 3012.465 / 3037.775|
|countercheck|rook (4,0)→(4,4) none|2202 / 2202 / 2202|indeterminate / indeterminate / indeterminate|79.961 / 78.501 / 69.424|
|countercheck-gote|rook (4,8)→(4,4) none|2202 / 2202 / 2202|indeterminate / indeterminate / indeterminate|384.101 / 397.606 / 391.514|
|single-evasion|king (8,8)→(8,7) none|-Infinity / -Infinity / -Infinity|indeterminate / indeterminate / indeterminate|348.194 / 374.288 / 346.128|
|single-evasion-gote|king (0,0)→(0,1) none|-Infinity / -Infinity / -Infinity|indeterminate / indeterminate / indeterminate|337.208 / 329.557 / 341.353|

Scores and PV endings are observations; only the saved bounded reference supports quality verdicts.
Every selected action, breakdown, PV, deadline/source/depth and all counters are retained in summary.json/raw.jsonl.
No selected action or reference verdict changed in the 224 paired B/C versus A observations.
