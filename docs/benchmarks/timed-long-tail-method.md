# 100ms探索の長い尾: 測定定義

`npm run measure:timed-long-tail -- --out docs/benchmarks/NAME.jsonl --pairs 2 --max-plies 120 --warmups 2 --runs 5` で同期直列に測る。`npm run audit:timed-long-tail -- docs/benchmarks/NAME.jsonl` が棋譜、標本数、時間と集計を再検算する。通常 CI には入れない。`--probe off` は対局の診断を無効にする。保存棋譜の3局面は常に対応する OFF/ON を交互順で測る。

探索 API の入力は通常 self-play と同じ複製済み再帰 Proxy、棋譜履歴と千日手条件を使う。対局は同じ探索設定、評価、合法着手選択と上限付き self-play を使う。上限到達は `max_plies` として残し、勝敗や棋力の証拠にしない。

時間には同一単調時計の3境界がある。`apiElapsedMilliseconds` は探索 API 内の開始時計から返却直前の終了時計まで。`callElapsedMilliseconds` は呼び出し側での呼出直前から戻り直後まで。`apiOtherMilliseconds` は API 内時間から入れ子を除いた工程時間を差し引いた残差。呼出後の検証、GC/ヒープ読取、JSON 化と診断の後処理は含めない。診断の終了は API 内で、最後の API 時計値を使う。診断 ON は工程のために注入時計を追加で読むので deadline 判定や結果が変わり得る。OFF/ON は同じ局面と反復番号で対応させるが、同一の実行状態とはみなさない。

PR #156 の `timed-depth-one-main-20260924.jsonl` は旧定義 `v1` である。そこでは診断の `finish` を呼出後に実行したため `api-other` と `diagnostics.totalMilliseconds` に呼出後処理の一部が入る。本 CLI と更新後の深さ1 CLI は `v2` である。旧ファイルは変更しない。

`longestCheckInterval` は探索開始または最後の deadline 確認で読んだ時計から次の確認で読んだ時計まで。最初の区間に root 合法手生成を含む。`phase` はその時点の活動中工程、活動中でなければ区間中に最も長く観測した工程を示す。複数処理、計測負荷、GC を含み得るため、単一関数の所要時間とは異なる。`longestOperation` は `measure` で囲った呼出しの包含時間で、子工程も含み得る。工程別 `maxMilliseconds` は同一工程の単一呼出しの最大値。root では駒ごとの合法移動生成と持駒種別ごとの合法打ち生成、静止探索では評価、王手判定、合法手生成、並べ替え、着手適用を測る。root の昇格展開とソート、静止探索の候補選別などは残余工程に入る。

Node の GC `PerformanceObserver` は同期探索の後にイベントループで通知を配送する。全探索が終わってからイベントを回収し、同じ `performance` 時間軸で GC 区間と API 呼出区間の交差を判定する。GC と長い手の重複は原因の証明ではない。観測不能なら `gc.status=unavailable` と理由を残す。`heap.before/after` は `process.memoryUsage().heapUsed` の取得時刻と値であり、探索中の真の最大値を示さない。観測不能なら理由を残す。保存棋譜の `g1-p115`、`g3-p55`、`g4-p89` は元棋譜から再生し、状態ハッシュと履歴長を監査する。
