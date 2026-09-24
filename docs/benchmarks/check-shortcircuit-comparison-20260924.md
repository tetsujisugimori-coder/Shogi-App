# 王手判定のboolean早期終了 Before / After

Before: `2578051d11ab4be2fc9e986a9cd27795b6f6b1ab`。After: `0d8135d6766274312a40c622f2ee4ec230f2a415`。
棋譜 SHA-256: `8b269f95bb3be422ab87fe2e64d1a5dcc342cf53048eb63d3c2424ebfbf1e552`。win32 10.0.26200 x64、Intel(R) Core(TM) i7-14650HX、Node v24.20.0。
4局面とも標準評価・標準手順序・静止探索追加1手・最大深さ4・100ms。各側とも1プロセス内で同期直列、ウォームアップ2回・本測定5回。BeforeとAfterは別プロセス・別時刻に実行。
100ms通常探索は診断OFF。攻撃元探索の件数は固定深さ1の診断ON。固定深さ1完走時間は診断を混ぜない独立プロセスで両側同じスクリプトを走らせた。

## 王手確認と攻撃元探索（固定深さ1・診断ON）

| 局面 | checks / searches 前→後 | 実走査マス 前→後 | 平均マス/回 前→後 | piece判定 前→後 | 早期終了 後 |
| --- | ---: | ---: | ---: | ---: | ---: |
| g1-p115 | 44770/44770 → 44770/44770 | 3,626,370 → 3,447,292 (4.94%減) | 81.00 → 77.00 | 620,018 → 581,029 | 3,476/44,770 (7.76%) |
| g3-p55 | 9883/9883 → 9883/9883 | 800,523 → 753,267 (5.90%減) | 81.00 → 76.22 | 166,103 → 154,484 | 728/9,883 (7.37%) |
| g4-p89 | 13270/13270 → 13270/13270 | 1,074,870 → 1,003,237 (6.66%減) | 81.00 → 75.60 | 210,016 → 194,743 | 1,063/13,270 (8.01%) |
| g1-p93 | 36420/36420 → 36420/36420 | 2,950,020 → 2,792,324 (5.35%減) | 81.00 → 76.67 | 540,830 → 502,928 | 3,073/36,420 (8.44%) |

## 固定深さ1（診断OFF）

| 局面 | Before中央値ms | After中央値ms | 時間短縮率 | 選択手（両側同一） | 評価（両側同一） |
| --- | ---: | ---: | ---: | --- | ---: |
| g1-p115 | 1853.08 | 1793.29 | 3.23% | {"kind":"move","player":"sente","from":{"row":7,"col":3},"to":{"row":4,"col":3},"pieceType":"rook","promotion":"none"} | 4772 |
| g3-p55 | 840.64 | 851.90 | -1.34% | {"kind":"drop","player":"sente","pieceId":"gote-rook-8","pieceType":"rook","to":{"row":2,"col":2},"promotion":"none"} | 3812 |
| g4-p89 | 1047.84 | 1129.50 | -7.79% | {"kind":"drop","player":"sente","pieceId":"gote-rook-8","pieceType":"rook","to":{"row":4,"col":7},"promotion":"none"} | 5412 |
| g1-p93 | 1641.27 | 1654.52 | -0.81% | {"kind":"move","player":"sente","from":{"row":7,"col":3},"to":{"row":4,"col":3},"pieceType":"rook","promotion":"none"} | 5205 |

## 100ms通常探索（診断OFF）

| 局面 | API中央値ms 前→後 | 完了深さ分布 前→後 | fallback 前→後 | root候補 |
| --- | ---: | --- | ---: | ---: |
| g1-p115 | 100.38 → 100.44 | 0×5 → 0×5 | 5/5 → 5/5 | 314 |
| g3-p55 | 100.20 → 100.17 | 0×5 → 0×5 | 5/5 → 5/5 | 222 |
| g4-p89 | 100.36 → 100.13 | 0×5 → 0×5 | 5/5 → 5/5 | 249 |
| g1-p93 | 100.50 → 100.24 | 0×5 → 0×5 | 5/5 → 5/5 | 289 |

| 局面 | Before 選択手 / 評価 | After 選択手 / 評価 |
| --- | --- | --- |
| g1-p115 | {"kind":"move","player":"sente","from":{"row":0,"col":5},"to":{"row":0,"col":4},"pieceType":"pawn","promotion":"none"} / null | {"kind":"move","player":"sente","from":{"row":0,"col":5},"to":{"row":0,"col":4},"pieceType":"pawn","promotion":"none"} / null (深さ0) |
| g3-p55 | {"kind":"move","player":"sente","from":{"row":6,"col":4},"to":{"row":5,"col":4},"pieceType":"pawn","promotion":"none"} / null | {"kind":"move","player":"sente","from":{"row":6,"col":4},"to":{"row":5,"col":4},"pieceType":"pawn","promotion":"none"} / null (深さ0) |
| g4-p89 | {"kind":"move","player":"sente","from":{"row":0,"col":3},"to":{"row":0,"col":2},"pieceType":"pawn","promotion":"none"} / null | {"kind":"move","player":"sente","from":{"row":0,"col":3},"to":{"row":0,"col":2},"pieceType":"pawn","promotion":"none"} / null (深さ0) |
| g1-p93 | {"kind":"move","player":"sente","from":{"row":1,"col":5},"to":{"row":0,"col":5},"pieceType":"pawn","promotion":"promote"} / null | {"kind":"move","player":"sente","from":{"row":1,"col":5},"to":{"row":0,"col":5},"pieceType":"pawn","promotion":"promote"} / null (深さ0) |

合法手配列の内容・順序、局面状態・履歴長・局面 SHA-256 は4局面すべて一致。固定深さ1の選択手・評価も全本で一致。100msで同じ完了深さの結果は一致し、深さが変わった場合の選択手・評価差は完了深さの差として扱う。入力状態は測定スクリプトで非破壊を確認。
100msのAPI時間は制限時間付近で打ち切られるため、速度改善率の指標として用いない。診断ONと通常探索を交互に測った旧固定深さ1系列ではJIT起因とみられる大きな段差があり、時間比較から除外した。独立系列でも試行間の変動が大きく、数％の差は有効な速度改善と断定できない。1台の測定で棋力や一般的な速度差は主張しない。
結論: 実走査とpiece判定は減ったが、100msで深さ1に届いた局面は0/4。固定深さ1の実時間短縮も確認できなかった。次PRでは攻撃判定以外の高頻度経路を測定して候補を絞る。

診断・100ms生データ: `docs/benchmarks/check-shortcircuit-before-20260924.jsonl`、`docs/benchmarks/check-shortcircuit-after-20260924.jsonl`。合法手監査: `docs/benchmarks/check-shortcircuit-legal-before-20260924.jsonl`、`docs/benchmarks/check-shortcircuit-legal-after-20260924.jsonl`。固定深さ1独立測定: `docs/benchmarks/check-shortcircuit-fixed-before-20260924.jsonl`、`docs/benchmarks/check-shortcircuit-fixed-after-20260924.jsonl`。
