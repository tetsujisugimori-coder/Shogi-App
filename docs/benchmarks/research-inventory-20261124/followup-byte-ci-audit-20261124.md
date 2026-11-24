# 第1期追補｜v4原バイト・ソース照合とW1 CI依存の追加分類
2026-11-24 JST。文書のみを追記する。固定元HEAD：Shogi-App PR #218 `ad82e73a3f9d72f860a8f4df0e10f525cdc77a33`。対象main `85d856b9bc6b7939977cdb2867f2cff3a84a9025`。元PR #218のコード・元原票・比較開始ゲート・履歴を変更しない。

## 原本と照合方法
GitHubの固定Git blobを各オブジェクトID（Git SHA-1）で読み、その返却本文からUTF-8バイトを再構成してSHA-256を独立計算した。SHA-256実装は空文字と `abc` の既知検査ベクトルに一致し、4journalの既存ハッシュとも一致した。**Git blob IDそのものをSHA-256扱いしていない**。バイト取得ができないgzip保存版はPASSに含めない。

1. [v4入力・観測ログ検査票](v4-input-hash-audit.tsv)：4 journal（計394手）と先行診断2入力、**計6件の全バイトSHA-256が、原`observations.jsonl`第1行のplanに固定された値と一致**。v4 `observations.jsonl` 自体も**1,084,471 bytesを取得**しSHA-256を新規算出：`66cb941288aeca77ee41c3d66c853d420004e3c4b474ada5c612c24017d4afa6`。比較する事前の期待値はなく、この1件の判定は `COMPUTED_NO_PREVIOUS_EXPECTATION`。
2. [99ソースの実測SHA-256対照表](source-hash-audit.tsv)：固定版の99 Git blobを再取得。**95件は原rawと一致しないが、CRLFをLFへ正規化した内容のSHA-256はv4の`source-provenance.json`と一致**（`LF_PASS_RAW_DIFF`）。**4件は現行固定版のLF内容も当時の記録と異なる**（`CONTENT_DIFF`）。取得失敗0、未照合0。
3. `CONTENT_DIFF` 4件は `scripts/benchmarks/gameBlunderPilot.ts`、`scripts/benchmarks/gameBlunderInvestigation.ts`、`scripts/investigate-game-blunders.ts`、`scripts/summarize-game-blunders.ts`。いずれもv4テストの `historicalSources` 集合に一致し、テストは `docs/benchmarks/game-blunder-review-20261111/baseline-sources/<basename>.gz` の歴史保存版を参照する。**4 gzipのGit tree存在は確認できるが、バイナリの独立取得は接続側のUTF-8制限で失敗。解凍・元raw byte照合は未成立**。現在のソースとの差分を履歴破損とは判定せず、当時のソースの完全立証は `UNKNOWN` のまま。
4. 原`observations.jsonl`のplanから `paths`（4 journal）、`priorFile`、`v3File`、`sourceHashes`（99エントリ）を直接読取り。先行2件のSHA-256は `priorHash`、`v3Hash` と照合。単なるソース中の文字列探索や事後の説明だけに依存していない。

## W1制御・専用CIの依存審査
[追加分類票](w1-ci-dependency-addendum.tsv)は、従前の[228パス台帳](dependency-ledger.tsv)に対する**23パスの増補差分**。W1専用CI `.github/workflows/stage-w1-verifiers.yml`を読み、**直接起動される12本の検証器**、および実ソースから読める**直接・間接importで必要な11本の補助コード**を `UNDETERMINED → KEEP` に昇格した。これらは現行CIでの検証経路として保持するための分類であり、**実行CIの成功・コード受入・比較開始を認めるものではない**。既存のKEEP/REFERENCE/RESEARCH行は変更しない。

| 区分 | 以前 | この追補後 |
| --- | ---: | ---: |
| KEEP | 108 | **131** |
| REFERENCE | 54 | **54** |
| RESEARCH | 2 | **2** |
| UNDETERMINED | 64 | **41** |
| 合計 | **228** | **228** |

未判定41件には過去の収録・preflight・snapshot・観測・preservation補助コードやW1i原票保全テストが含まれる。7診断テストと今回見たW1専用CIの直接・間接呼出しのみでは削除・汎用移管の可否を保証できないので、そのままにした。

## 判定・保全
- **今回の限定結論：** v4の動的入力6件の全バイト同一性PASS、v4観測ログの独立SHA-256算出、99現行ソースの95件LF内容一致／4件履歴相違は設計上の保存版参照待ち、W1 CI依存23件のKEEP分類を証拠付きで実施。
- **未完了：** gzip歴史保存版4件の独立読戻し・解凍・原raw SHA-256、99ソース全ての実験時raw同一性、W1未判定41件の他入口／履歴依存審査、実診断7テストと正式CIの今回の実行結果、全再帰importの網羅性。
- **不変：** PR #218はDraft・マージ推奨NO、比較ゲートは `BLOCKED`、`permit=false`、正式旧0／新0、S4/S5 `NOT_TESTED`、R8/H1〜H4 `UNKNOWN`。新しい比較実行は行わない。履歴、元原票、既存保存物を削除・移動・上書きしない。分類表の追補は元の独立レビュー完了を意味しない。
- **次の最小工程：** 4 gzipの生バイトへ権限のある正規手段でアクセスできる時に、その4件に限った独立照合を実施。許可されない環境では `UNKNOWN`を維持する。未判定41件はStage W1 runnerの過去起動・証拠の再集計からの参照も確認し、検証できた行だけ別追補へ追加する。
