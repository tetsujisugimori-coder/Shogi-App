# root合法手生成の内訳: 定義と再実行

基点は PR #158 を含む main `1b6e05daf6d09e6641feff54d13d4bfdeb788dc3`。今回の計測は `root-legal-breakdown-v1` と `root-legal-context-v1` の新スキーマに保存する。既存 `long-tail-v1` のデータと監査CLIは変更しない。長時間測定は通常CIで実行しない。

`npm run measure:root-legal-breakdown -- --out docs/benchmarks/NAME.jsonl --warmups 2 --runs 5 --stage-timing on` で、保存棋譜から `g1-p115`、`g3-p55`、`g4-p89`、`g1-p93` を再生する。`--positions g3-p117` で PR #158 の持駒打ち単一最大値が出た補助局面を選べる。OFF/ONは同じ局面の反復番号で対応させ、先行順を交互にする。各探索は通常セルフプレイと同じ `protectSearchInput` を経由する。`--stage-timing off` なら高費用工程の回数だけ記録する。少数局面の両設定のパイロット後に詳細本測定を行った。`npm run audit:root-legal-breakdown -- PATH.jsonl` で、元棋譜SHA、局面・合法手列ハッシュ、入力不変性の測定側確認、反復件数、候補・合法・却下理由、工程回数、包含時間と残余を監査する。

`validateDrop` の判定順は、終局→範囲→持駒所有→王不可→成駒不可→占有→行き所→二歩→盤面複製→自玉王手→歩打ち詰め。`getLegalDropSquares` は有効な持駒について81マスを行列順に調べる。理由の件数は `validateDrop` が最初に返した理由であり、後続の判定を通した場合の理由数ではない。盤面複製工程は `simulateDropSquares` 全体（複製と打ち駒の配置）、自玉王手は `isKingInCheck`、歩打ち詰めは `isPawnDropMateOnSimulatedBoard` を囲む。盤面複製・王手判定の時計読みは `--stage-timing on` のrootだけで行い、通常対局の診断OFFでは行わない。

PR #159後の最適化測定は `root-legal-breakdown-v2` を使用する。v2の `drop-board-setup` は `validateDrop` 内だけで外側配列、打ち先の行とマス、打つ駒を複製・配置する時間である。v1の `board-clone` は公開 `simulateDropSquares` を呼び、全81マスと各駒の複製・配置を含む。工程の処理範囲が異なるため、この2列を同一工程の前後差として扱わない。残りの計測境界と設定は同じ。公開 `simulateDropSquares` と実行時の深い複製は維持する。

root全体は `root-legal` の単一呼出し包含時間。盤上移動と持駒打ちは既存 `SearchDiagnostics` の入れ子排他的時間で、残余=`root全体−盤上移動−持駒打ち`。駒種別打ち時間は `getLegalDropSquares` 呼出しだけを囲み、後続のソートは含めない。その工程時間は駒種別打ち時間に含まれ、root全体へ再加算しない。合計は同種の複数呼出しにわたる和、単一最大は1呼出しの最大値。駒種別の追加時計と既存の `root-hand-drops` の時計境界は異なり、完全一致する値ではない。候補全81マスの各検証全体に細かな時計は置かない。呼出全体の実時間はAPI呼出直前から戻り直後まで、100ms超過はそこから100msを引いた符号付き値。中央値は各系列を別々に算出するので足し算できない。診断ON/OFF差を診断の純粋な費用とはみなさない。

`npm run measure:root-legal-context -- docs/benchmarks/NAME.jsonl` は元の保存棋譜4局を、毎手保護入力で100ms探索した後に保存済みの着手で進める。探索の選択手で局面を進めないため各対象局面を正確に保持し、連続呼出しと入力保護の文脈を観察できる。ウォームアップ・反復はない。結果は実対局の新たな棋譜ではない。`npm run audit:root-legal-context -- PATH.jsonl` は全480手の元棋譜、positionKeyハッシュ、対象局面一致、rootの件数と残余を照合する。

報告は [4局面の本測定](root-legal-main-20260924.md)、[単一打ち最大があった補助局面](root-legal-g3-p117-20260924.md)、[保存棋譜の連続再生](root-legal-context-20260924.md)。PR #158の元結果は [long-tail報告](timed-long-tail-main-20260924.md)。今回の同一機測定では大きな超過は再現せず、元の415.56ms区間の全因果は確定できない。4局はいずれも手数上限打切であり、勝敗・棋力への影響は判断できない。
