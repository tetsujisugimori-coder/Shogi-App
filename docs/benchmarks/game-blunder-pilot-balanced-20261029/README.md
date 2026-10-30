# 実戦棋譜診断の試作（未完成）

この試作は完成版ではない。基準HEAD `85d856b9bc6b7939977cdb2867f2cff3a84a9025`、元測定source `05cbb8cdfe3b7574a630d22a3dfb9a75d379fdcb`。元journalを上書きせず既存`auditJournal`で合法再生・評価・PV・整合性を検査した。4局394手のうち1局120手は手数上限であり、規則引分ではない。

対象は直後の記録手で移動駒が取られる局面のみ。これは大きな駒損を示さず、意図的な交換も含む。分類Aの**調査トリガー**としてのみ扱う。B〜F、原因切り分け、強制詰みの証明は未実装。先頭からではなく各journalから交互に24局面まで選ぶ。各局面の参照は元手番と同じ評価モードと探索設定で、候補選択に1000ms、異なる手が出た場合は両着手後それぞれ1000ms、最大深さ4。合計120秒は局面間のソフト上限で、APIの単一処理を中断できず厳密な壁時計上限ではない。着手後の評価は相手視点なので符号を反転し、双方の完了深さが同じ有限値だけ比較。300点は駒価値100の歩3枚相当の**探索上の暫定トリガー**であって悪手の閾値ではない。参照も同じ評価器を使うため独立した正解ではない。

候補56、対象24、SUSPECTED 4、INCONCLUSIVE 20、CONFIRMED 0。4件は有限評価差だけの疑いで、実際に損失が避けられたかは未確認。INCONCLUSIVEには代替手が同一、途中結果、深さ不一致が含まれる。時限探索はOS負荷等で再実行ごとに結果が変わり得る。抽出の順序は固定だが時限探索結果の決定性は保証しない。値の非有限数はJSON文字列化でnullとなるため、有限値と同じ根拠に使えない。

## 再現

リポジトリrootから、新規ディレクトリ名を指定する。既存出力は上書きしない。JSONには原本SHA256、局面hash、手、元探索、参照探索のPV・深さ・時間・統計を含む。記録されたplyの直前まで元journalを再生する。

```powershell
node --import tsx scripts/diagnose-game-blunder-pilot.ts NEW_OUTPUT_DIR docs/benchmarks/match-journal-20261026/run1/hirate-1.jsonl docs/benchmarks/match-journal-20261026/run1/hirate-2.jsonl docs/benchmarks/match-journal-20261026/run1/replay-1.jsonl docs/benchmarks/match-journal-20261026/run1/replay-2.jsonl
```

`game-blunder-pilot-20261029`は先行試行で、全24局面が最初の対局に偏り、AとDを一律付与した誤りがある。原結果を変更せず参考記録とし、D分類と件数を採用しない。この均等抽出は先行試行と別の時限実行である。実行時の未コミット診断ソースSHA256: `scripts/benchmarks/gameBlunderPilot.ts` = `f6d8e77604c1d3ba4af59ce6fb73715604a54d9daaf1ac78922dddaadb182468`、`scripts/diagnose-game-blunder-pilot.ts` = `76a02c90cdef7f71e169310959d24e8b5b460f9e8a70a02a79f66c97867a5d65`。

未実施: 6分類の正確な実装、合法交換・ピン・王手・詰み証明、タイムアウト・符号・不成・駒打ち等の十分な回帰、再現性検証、原因のコード根拠、改善優先順位。予備結果だけから探索・評価処理の優先順位や棋力を結論しない。
