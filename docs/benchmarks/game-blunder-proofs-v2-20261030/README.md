# 旧疑い4件の限定勝敗証明

旧pilotの疑い4局面について、実手と旧参照候補の計8手を既存AND/OR証明器で各depth 5、1000ノード、1250ms、1MiB、順方向で直列実行。両候補で2.5秒の探索予算、別途証明の検証にも各1250msを割り当てる。単一操作は協調的期限を超過し得る。取得証明があれば別検証器が全必要合法枝を再生する。距離最適性は扱わない。

全8手がunknown、全8手でtime停止、到達83〜203ノード程度（詳細はJSON）。証明は生成されず検証可能な証明もない。負け・勝ちのどちらも断定できない。再診断のINDETERMINATEは維持し、SEEなどの原因を裏付けない。

先行 `game-blunder-proofs-20261030` は記録由来の実手のオブジェクトキー順と証明器のJSON比較が一致せず、実手4件は入力エラー、代替4件は時間切れ。今回のスクリプトは既存の意味的手比較を用い局面の合法手一覧から手を再取得して証明器へ渡す。先行結果は変更しない。両runの前後journal hashは一致。

```powershell
node --import tsx scripts/diagnose-blunder-proofs.ts NEW_OUTPUT_DIR docs/benchmarks/game-blunder-pilot-balanced-20261029/candidates.json docs/benchmarks/match-journal-20261026/run1/hirate-1.jsonl docs/benchmarks/match-journal-20261026/run1/hirate-2.jsonl docs/benchmarks/match-journal-20261026/run1/replay-1.jsonl docs/benchmarks/match-journal-20261026/run1/replay-2.jsonl
```

測定source HEAD、証明コードと呼出しコードの合同hash、条件、各手と停止位置は `proofs.json`。探索結果は時限実行なので繰り返しても一致を保証しない。
