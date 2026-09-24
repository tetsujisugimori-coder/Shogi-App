# 連続対局でのroot合法手生成

コード 1b6e05daf6d09e6641feff54d13d4bfdeb788dc3、dirty=true、Node v24.20.0、win32 10.0.26200 x64、Intel(R) Core(TM) i7-14650HX。
設定 {"pairCount":2,"maxPlies":120,"timeLimitMilliseconds":100,"maxDepth":4,"evaluationPreset":"standard","moveOrdering":"standard","quiescenceMoveOrdering":"original","maxTacticalDepth":1,"initialPosition":"standard-hirate"}。保存棋譜4局を各手の保護入力探索後に元の着手で再生。診断ON・工程内の時計読みOFF。ウォームアップと反復なし。
局面一致は保存棋譜のpositionKeyハッシュで判定。最大は単一呼出し、合計は呼出しをまたぐ累積。

| 局面 | 保存局面一致 | 呼出ms | 超過ms | root全体ms | 移動ms | 打ちms | 残余ms | 打ち単一最大ms | 深さ | 返却 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| g1-p93 | true | 101.87 | 1.87 | 50.08 | 6.46 | 43.49 | 0.13 | 10.29 | 0 | fallback |
| g1-p115 | true | 100.44 | 0.44 | 53.71 | 6.43 | 47.18 | 0.10 | 10.66 | 0 | fallback |
| g3-p55 | true | 100.56 | 0.56 | 38.93 | 7.55 | 31.29 | 0.08 | 9.09 | 0 | fallback |
| g3-p117 | true | 100.22 | 0.22 | 45.35 | 6.59 | 38.65 | 0.11 | 10.89 | 0 | fallback |
| g4-p89 | true | 100.57 | 0.57 | 43.59 | 6.86 | 36.65 | 0.08 | 10.76 | 0 | fallback |

全再生サンプル480件。保存局面との一致をpositionKeyで確認。探索が返した手では進めず元棋譜の手を適用したため、連続対局の探索配分と同一条件ではない。詳細と各駒種の件数・時間はJSONL。
