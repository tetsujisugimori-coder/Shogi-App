# Root合法手生成の内訳

コード 1b6e05daf6d09e6641feff54d13d4bfdeb788dc3、dirty=true、Node v24.20.0、win32 10.0.26200 x64、Intel(R) Core(TM) i7-14650HX。
設定 {"maxDepth":4,"timeLimitMilliseconds":100,"evaluationPreset":"standard","moveOrdering":"standard","quiescenceMoveOrdering":"original","maxTacticalDepth":1}。ウォームアップ2回、本測定5回、stageTiming=on。詳細は同名JSONL。
root全体は包含時間。移動と打ちの合計は排他的区間、残余はroot全体から差し引いた値。駒種別打ち時間と工程時間は包含関係なので重ねて加算しない。最大は単一呼出し、合計は全呼出し。

| 局面 | 診断 | 本測定数 | 呼出中央値ms | 最大超過ms | fallback | root中央値ms | 移動中央値ms | 打ち中央値ms | 残余中央値ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| g1-p115 | OFF | 5 | 100.42 | 1.90 | 5 | — | — | — | — |
| g1-p115 | ON | 5 | 100.31 | 1.24 | 5 | 49.32 | 6.11 | 42.96 | 0.16 |
| g3-p55 | OFF | 5 | 100.47 | 0.49 | 5 | — | — | — | — |
| g3-p55 | ON | 5 | 100.30 | 0.43 | 5 | 35.84 | 6.27 | 29.46 | 0.08 |
| g4-p89 | OFF | 5 | 100.24 | 0.41 | 5 | — | — | — | — |
| g4-p89 | ON | 5 | 100.37 | 0.46 | 5 | 39.12 | 6.26 | 32.83 | 0.09 |
| g1-p93 | OFF | 5 | 100.69 | 0.99 | 5 | — | — | — | — |
| g1-p93 | ON | 5 | 101.11 | 1.87 | 5 | 45.88 | 5.93 | 39.54 | 0.09 |

以下の合計は診断ONの本測定反復を通算した値。最大は全反復の単一呼出し最大。工程時間は打ち生成時間に含まれる。

| 局面 | 工程 | 呼出 | 合計ms | 単一最大ms | 候補 | 合法 | 却下理由 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| g1-p115 | root全体 | 5 | 246.90 | 50.69 | — | — | — |
| g1-p115 | 盤上移動 | 65 | 30.74 | 2.14 | — | — | — |
| g1-p115 | 持駒打ち | 25 | 215.39 | 10.02 | — | — | — |
| g1-p115 | 残余 | 5 | 0.77 | 0.18 | — | — | — |
| g1-p115 | gold打ち | 5 | 47.76 | 10.02 | 405 | 305 | {"occupied_drop_square":100} |
| g1-p115 | gold/board-clone | 305 | 46.81 | 1.00 | — | — | — |
| g1-p115 | gold/own-check | 305 | 0.40 | 0.00 | — | — | — |
| g1-p115 | silver打ち | 5 | 46.71 | 9.47 | 405 | 305 | {"occupied_drop_square":100} |
| g1-p115 | silver/board-clone | 305 | 45.78 | 0.30 | — | — | — |
| g1-p115 | silver/own-check | 305 | 0.38 | 0.00 | — | — | — |
| g1-p115 | knight打ち | 5 | 38.59 | 8.12 | 405 | 240 | {"dead_piece_drop":65,"occupied_drop_square":100} |
| g1-p115 | knight/board-clone | 240 | 37.89 | 0.91 | — | — | — |
| g1-p115 | knight/own-check | 240 | 0.33 | 0.01 | — | — | — |
| g1-p115 | lance打ち | 5 | 42.58 | 9.10 | 405 | 275 | {"dead_piece_drop":30,"occupied_drop_square":100} |
| g1-p115 | lance/board-clone | 275 | 41.82 | 0.36 | — | — | — |
| g1-p115 | lance/own-check | 275 | 0.35 | 0.01 | — | — | — |
| g1-p115 | pawn打ち | 5 | 39.68 | 9.53 | 405 | 235 | {"dead_piece_drop":30,"occupied_drop_square":100,"nifu":40} |
| g1-p115 | pawn/board-clone | 235 | 37.82 | 1.07 | — | — | — |
| g1-p115 | pawn/own-check | 235 | 0.32 | 0.01 | — | — | — |
| g1-p115 | pawn/pawn-drop-mate | 235 | 0.58 | 0.06 | — | — | — |
| g3-p55 | root全体 | 5 | 180.48 | 37.15 | — | — | — |
| g3-p55 | 盤上移動 | 80 | 31.90 | 1.17 | — | — | — |
| g3-p55 | 持駒打ち | 20 | 148.14 | 9.06 | — | — | — |
| g3-p55 | 残余 | 5 | 0.44 | 0.10 | — | — | — |
| g3-p55 | rook打ち | 5 | 42.41 | 8.67 | 405 | 260 | {"occupied_drop_square":145} |
| g3-p55 | rook/board-clone | 260 | 41.56 | 0.38 | — | — | — |
| g3-p55 | rook/own-check | 260 | 0.45 | 0.07 | — | — | — |
| g3-p55 | gold打ち | 5 | 42.20 | 9.06 | 405 | 260 | {"occupied_drop_square":145} |
| g3-p55 | gold/board-clone | 260 | 41.42 | 0.30 | — | — | — |
| g3-p55 | gold/own-check | 260 | 0.36 | 0.01 | — | — | — |
| g3-p55 | silver打ち | 5 | 42.36 | 8.73 | 405 | 260 | {"occupied_drop_square":145} |
| g3-p55 | silver/board-clone | 260 | 41.56 | 0.31 | — | — | — |
| g3-p55 | silver/own-check | 260 | 0.38 | 0.01 | — | — | — |
| g3-p55 | pawn打ち | 5 | 21.13 | 4.64 | 405 | 125 | {"dead_piece_drop":20,"occupied_drop_square":145,"nifu":115} |
| g3-p55 | pawn/board-clone | 125 | 19.75 | 0.42 | — | — | — |
| g3-p55 | pawn/own-check | 125 | 0.19 | 0.01 | — | — | — |
| g3-p55 | pawn/pawn-drop-mate | 125 | 0.44 | 0.05 | — | — | — |
| g4-p89 | root全体 | 5 | 199.75 | 42.25 | — | — | — |
| g4-p89 | 盤上移動 | 75 | 34.00 | 2.87 | — | — | — |
| g4-p89 | 持駒打ち | 20 | 165.14 | 9.69 | — | — | — |
| g4-p89 | 残余 | 5 | 0.60 | 0.19 | — | — | — |
| g4-p89 | rook打ち | 5 | 44.79 | 9.17 | 405 | 280 | {"occupied_drop_square":125} |
| g4-p89 | rook/board-clone | 280 | 43.92 | 0.30 | — | — | — |
| g4-p89 | rook/own-check | 280 | 0.40 | 0.01 | — | — | — |
| g4-p89 | gold打ち | 5 | 43.92 | 8.90 | 405 | 280 | {"occupied_drop_square":125} |
| g4-p89 | gold/board-clone | 280 | 43.05 | 0.40 | — | — | — |
| g4-p89 | gold/own-check | 280 | 0.38 | 0.03 | — | — | — |
| g4-p89 | silver打ち | 5 | 45.00 | 9.69 | 405 | 280 | {"occupied_drop_square":125} |
| g4-p89 | silver/board-clone | 280 | 44.19 | 1.07 | — | — | — |
| g4-p89 | silver/own-check | 280 | 0.39 | 0.02 | — | — | — |
| g4-p89 | pawn打ち | 5 | 31.39 | 6.32 | 405 | 195 | {"dead_piece_drop":20,"occupied_drop_square":125,"nifu":65} |
| g4-p89 | pawn/board-clone | 195 | 29.87 | 0.21 | — | — | — |
| g4-p89 | pawn/own-check | 195 | 0.24 | 0.01 | — | — | — |
| g4-p89 | pawn/pawn-drop-mate | 195 | 0.48 | 0.05 | — | — | — |
| g1-p93 | root全体 | 5 | 229.34 | 46.59 | — | — | — |
| g1-p93 | 盤上移動 | 70 | 29.89 | 2.05 | — | — | — |
| g1-p93 | 持駒打ち | 25 | 198.97 | 10.50 | — | — | — |
| g1-p93 | 残余 | 5 | 0.48 | 0.10 | — | — | — |
| g1-p93 | gold打ち | 5 | 47.78 | 10.50 | 405 | 295 | {"occupied_drop_square":110} |
| g1-p93 | gold/board-clone | 295 | 46.88 | 1.03 | — | — | — |
| g1-p93 | gold/own-check | 295 | 0.39 | 0.00 | — | — | — |
| g1-p93 | silver打ち | 5 | 47.48 | 10.38 | 405 | 295 | {"occupied_drop_square":110} |
| g1-p93 | silver/board-clone | 295 | 46.54 | 1.36 | — | — | — |
| g1-p93 | silver/own-check | 295 | 0.40 | 0.03 | — | — | — |
| g1-p93 | knight打ち | 5 | 35.98 | 7.38 | 405 | 230 | {"dead_piece_drop":65,"occupied_drop_square":110} |
| g1-p93 | knight/board-clone | 230 | 35.33 | 0.29 | — | — | — |
| g1-p93 | knight/own-check | 230 | 0.30 | 0.02 | — | — | — |
| g1-p93 | lance打ち | 5 | 40.15 | 8.24 | 405 | 260 | {"dead_piece_drop":35,"occupied_drop_square":110} |
| g1-p93 | lance/board-clone | 260 | 39.47 | 0.30 | — | — | — |
| g1-p93 | lance/own-check | 260 | 0.32 | 0.01 | — | — | — |
| g1-p93 | pawn打ち | 5 | 27.53 | 5.69 | 405 | 165 | {"dead_piece_drop":35,"occupied_drop_square":110,"nifu":95} |
| g1-p93 | pawn/board-clone | 165 | 25.96 | 0.40 | — | — | — |
| g1-p93 | pawn/own-check | 165 | 0.25 | 0.02 | — | — | — |
| g1-p93 | pawn/pawn-drop-mate | 165 | 0.52 | 0.08 | — | — | — |

各試行の完了深さ、fallback、選択手はJSONLに保存。診断ON-OFF差は測定負荷だけを表さない。

診断ONの本測定20回ではroot全体856.46ms、持駒打ち727.65ms、盤面複製工程709.63ms。今回のroot費用では盤面複製が主な候補である。
PR #158のg1-p93では415.56msの期限確認間隔に複数の持駒打ち生成が含まれ、打ち生成の合計は360.60msだった。今回その長い尾は再現しておらず、当時の工程内部時間やOS・JIT・GC等の寄与は未確定。単一呼出しの最大値だけで415.56msを説明しない。4局の手数上限打切から勝敗・棋力は推定しない。
