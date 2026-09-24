# Root合法手生成の内訳

コード 1b6e05daf6d09e6641feff54d13d4bfdeb788dc3、dirty=true、Node v24.20.0、win32 10.0.26200 x64、Intel(R) Core(TM) i7-14650HX。
設定 {"maxDepth":4,"timeLimitMilliseconds":100,"evaluationPreset":"standard","moveOrdering":"standard","quiescenceMoveOrdering":"original","maxTacticalDepth":1}。ウォームアップ1回、本測定2回、stageTiming=off。詳細は同名JSONL。
root全体は包含時間。移動と打ちの合計は排他的区間、残余はroot全体から差し引いた値。駒種別打ち時間と工程時間は包含関係なので重ねて加算しない。最大は単一呼出し、合計は全呼出し。

| 局面 | 診断 | 本測定数 | 呼出中央値ms | 最大超過ms | fallback | root中央値ms | 移動中央値ms | 打ち中央値ms | 残余中央値ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| g3-p55 | OFF | 2 | 100.45 | 0.45 | 2 | — | — | — | — |
| g3-p55 | ON | 2 | 100.45 | 0.45 | 2 | 36.68 | 6.17 | 30.55 | 0.12 |
| g1-p93 | OFF | 2 | 101.03 | 1.03 | 2 | — | — | — | — |
| g1-p93 | ON | 2 | 101.25 | 1.25 | 2 | 45.36 | 5.89 | 39.35 | 0.13 |

以下の合計は診断ONの本測定反復を通算した値。最大は全反復の単一呼出し最大。工程時間は打ち生成時間に含まれる。

| 局面 | 工程 | 呼出 | 合計ms | 単一最大ms | 候補 | 合法 | 却下理由 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| g3-p55 | root全体 | 2 | 73.31 | 36.68 | — | — | — |
| g3-p55 | 盤上移動 | 32 | 12.17 | 1.05 | — | — | — |
| g3-p55 | 持駒打ち | 8 | 60.92 | 9.20 | — | — | — |
| g3-p55 | 残余 | 2 | 0.22 | 0.12 | — | — | — |
| g3-p55 | rook打ち | 2 | 17.37 | 9.19 | 162 | 104 | {"occupied_drop_square":58} |
| g3-p55 | rook/board-clone | 104 | 0.00 | 0.00 | — | — | — |
| g3-p55 | rook/own-check | 104 | 0.00 | 0.00 | — | — | — |
| g3-p55 | gold打ち | 2 | 17.55 | 8.94 | 162 | 104 | {"occupied_drop_square":58} |
| g3-p55 | gold/board-clone | 104 | 0.00 | 0.00 | — | — | — |
| g3-p55 | gold/own-check | 104 | 0.00 | 0.00 | — | — | — |
| g3-p55 | silver打ち | 2 | 17.44 | 8.93 | 162 | 104 | {"occupied_drop_square":58} |
| g3-p55 | silver/board-clone | 104 | 0.00 | 0.00 | — | — | — |
| g3-p55 | silver/own-check | 104 | 0.00 | 0.00 | — | — | — |
| g3-p55 | pawn打ち | 2 | 8.53 | 4.49 | 162 | 50 | {"dead_piece_drop":8,"occupied_drop_square":58,"nifu":46} |
| g3-p55 | pawn/board-clone | 50 | 0.00 | 0.00 | — | — | — |
| g3-p55 | pawn/own-check | 50 | 0.00 | 0.00 | — | — | — |
| g3-p55 | pawn/pawn-drop-mate | 50 | 0.00 | 0.00 | — | — | — |
| g1-p93 | root全体 | 2 | 89.54 | 45.36 | — | — | — |
| g1-p93 | 盤上移動 | 28 | 11.56 | 1.62 | — | — | — |
| g1-p93 | 持駒打ち | 10 | 77.74 | 9.60 | — | — | — |
| g1-p93 | 残余 | 2 | 0.24 | 0.13 | — | — | — |
| g1-p93 | gold打ち | 2 | 17.96 | 9.03 | 162 | 118 | {"occupied_drop_square":44} |
| g1-p93 | gold/board-clone | 118 | 0.00 | 0.00 | — | — | — |
| g1-p93 | gold/own-check | 118 | 0.00 | 0.00 | — | — | — |
| g1-p93 | silver打ち | 2 | 18.79 | 9.60 | 162 | 118 | {"occupied_drop_square":44} |
| g1-p93 | silver/board-clone | 118 | 0.00 | 0.00 | — | — | — |
| g1-p93 | silver/own-check | 118 | 0.00 | 0.00 | — | — | — |
| g1-p93 | knight打ち | 2 | 13.88 | 6.95 | 162 | 92 | {"dead_piece_drop":26,"occupied_drop_square":44} |
| g1-p93 | knight/board-clone | 92 | 0.00 | 0.00 | — | — | — |
| g1-p93 | knight/own-check | 92 | 0.00 | 0.00 | — | — | — |
| g1-p93 | lance打ち | 2 | 16.53 | 8.79 | 162 | 104 | {"dead_piece_drop":14,"occupied_drop_square":44} |
| g1-p93 | lance/board-clone | 104 | 0.00 | 0.00 | — | — | — |
| g1-p93 | lance/own-check | 104 | 0.00 | 0.00 | — | — | — |
| g1-p93 | pawn打ち | 2 | 10.56 | 5.37 | 162 | 66 | {"dead_piece_drop":14,"occupied_drop_square":44,"nifu":38} |
| g1-p93 | pawn/board-clone | 66 | 0.00 | 0.00 | — | — | — |
| g1-p93 | pawn/own-check | 66 | 0.00 | 0.00 | — | — | — |
| g1-p93 | pawn/pawn-drop-mate | 66 | 0.00 | 0.00 | — | — | — |

各試行の完了深さ、fallback、選択手はJSONLに保存。診断ON-OFF差は測定負荷だけを表さない。
