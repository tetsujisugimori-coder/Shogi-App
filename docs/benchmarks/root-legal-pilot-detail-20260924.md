# Root合法手生成の内訳

コード 1b6e05daf6d09e6641feff54d13d4bfdeb788dc3、dirty=true、Node v24.20.0、win32 10.0.26200 x64、Intel(R) Core(TM) i7-14650HX。
設定 {"maxDepth":4,"timeLimitMilliseconds":100,"evaluationPreset":"standard","moveOrdering":"standard","quiescenceMoveOrdering":"original","maxTacticalDepth":1}。ウォームアップ1回、本測定2回、stageTiming=on。詳細は同名JSONL。
root全体は包含時間。移動と打ちの合計は排他的区間、残余はroot全体から差し引いた値。駒種別打ち時間と工程時間は包含関係なので重ねて加算しない。最大は単一呼出し、合計は全呼出し。

| 局面 | 診断 | 本測定数 | 呼出中央値ms | 最大超過ms | fallback | root中央値ms | 移動中央値ms | 打ち中央値ms | 残余中央値ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| g3-p55 | OFF | 2 | 100.40 | 0.40 | 2 | — | — | — | — |
| g3-p55 | ON | 2 | 100.40 | 0.40 | 2 | 36.29 | 6.23 | 29.94 | 0.12 |
| g1-p93 | OFF | 2 | 100.97 | 0.97 | 2 | — | — | — | — |
| g1-p93 | ON | 2 | 101.21 | 1.21 | 2 | 45.74 | 5.82 | 39.81 | 0.12 |

以下の合計は診断ONの本測定反復を通算した値。最大は全反復の単一呼出し最大。工程時間は打ち生成時間に含まれる。

| 局面 | 工程 | 呼出 | 合計ms | 単一最大ms | 候補 | 合法 | 却下理由 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| g3-p55 | root全体 | 2 | 71.53 | 36.29 | — | — | — |
| g3-p55 | 盤上移動 | 32 | 12.29 | 1.03 | — | — | — |
| g3-p55 | 持駒打ち | 8 | 59.01 | 9.05 | — | — | — |
| g3-p55 | 残余 | 2 | 0.24 | 0.12 | — | — | — |
| g3-p55 | rook打ち | 2 | 17.27 | 8.69 | 162 | 104 | {"occupied_drop_square":58} |
| g3-p55 | rook/board-clone | 104 | 16.90 | 0.71 | — | — | — |
| g3-p55 | rook/own-check | 104 | 0.16 | 0.00 | — | — | — |
| g3-p55 | gold打ち | 2 | 17.24 | 9.05 | 162 | 104 | {"occupied_drop_square":58} |
| g3-p55 | gold/board-clone | 104 | 16.87 | 0.98 | — | — | — |
| g3-p55 | gold/own-check | 104 | 0.17 | 0.02 | — | — | — |
| g3-p55 | silver打ち | 2 | 16.21 | 8.17 | 162 | 104 | {"occupied_drop_square":58} |
| g3-p55 | silver/board-clone | 104 | 15.88 | 0.18 | — | — | — |
| g3-p55 | silver/own-check | 104 | 0.16 | 0.01 | — | — | — |
| g3-p55 | pawn打ち | 2 | 8.27 | 4.14 | 162 | 50 | {"dead_piece_drop":8,"occupied_drop_square":58,"nifu":46} |
| g3-p55 | pawn/board-clone | 50 | 7.76 | 0.17 | — | — | — |
| g3-p55 | pawn/own-check | 50 | 0.07 | 0.00 | — | — | — |
| g3-p55 | pawn/pawn-drop-mate | 50 | 0.17 | 0.05 | — | — | — |
| g1-p93 | root全体 | 2 | 90.92 | 45.74 | — | — | — |
| g1-p93 | 盤上移動 | 28 | 11.55 | 1.75 | — | — | — |
| g1-p93 | 持駒打ち | 10 | 79.13 | 10.37 | — | — | — |
| g1-p93 | 残余 | 2 | 0.24 | 0.12 | — | — | — |
| g1-p93 | gold打ち | 2 | 19.53 | 10.37 | 162 | 118 | {"occupied_drop_square":44} |
| g1-p93 | gold/board-clone | 118 | 19.13 | 0.99 | — | — | — |
| g1-p93 | gold/own-check | 118 | 0.17 | 0.01 | — | — | — |
| g1-p93 | silver打ち | 2 | 17.80 | 8.91 | 162 | 118 | {"occupied_drop_square":44} |
| g1-p93 | silver/board-clone | 118 | 17.44 | 0.18 | — | — | — |
| g1-p93 | silver/own-check | 118 | 0.15 | 0.00 | — | — | — |
| g1-p93 | knight打ち | 2 | 14.21 | 7.25 | 162 | 92 | {"dead_piece_drop":26,"occupied_drop_square":44} |
| g1-p93 | knight/board-clone | 92 | 13.95 | 0.28 | — | — | — |
| g1-p93 | knight/own-check | 92 | 0.12 | 0.00 | — | — | — |
| g1-p93 | lance打ち | 2 | 16.72 | 8.81 | 162 | 104 | {"dead_piece_drop":14,"occupied_drop_square":44} |
| g1-p93 | lance/board-clone | 104 | 16.43 | 0.98 | — | — | — |
| g1-p93 | lance/own-check | 104 | 0.13 | 0.00 | — | — | — |
| g1-p93 | pawn打ち | 2 | 10.85 | 5.47 | 162 | 66 | {"dead_piece_drop":14,"occupied_drop_square":44,"nifu":38} |
| g1-p93 | pawn/board-clone | 66 | 10.20 | 0.24 | — | — | — |
| g1-p93 | pawn/own-check | 66 | 0.09 | 0.01 | — | — | — |
| g1-p93 | pawn/pawn-drop-mate | 66 | 0.21 | 0.06 | — | — | — |

各試行の完了深さ、fallback、選択手はJSONLに保存。診断ON-OFF差は測定負荷だけを表さない。
