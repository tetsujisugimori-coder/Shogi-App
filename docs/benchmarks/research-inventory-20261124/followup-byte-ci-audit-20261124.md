# 第1期追補｜v4原バイト・ソース照合とW1 CI依存の追加分類
2026-11-24 JST。文書のみを追記する。固定元HEAD：Shogi-App PR #218 `ad82e73a3f9d72f860a8f4df0e10f525cdc77a33`。対象main `85d856b9bc6b7939977cdb2867f2cff3a84a9025`。元PR #218のコード・元原票・比較開始ゲート・履歴を変更しない。

## 原本と照合方法
GitHubの固定Git blobを各オブジェクトID（Git SHA-1）で読み、その返却本文からUTF-8バイトを再構成してSHA-256を独立計算した。SHA-256実装は空文字と `abc` の既知検査ベクトルに一致し、4journalの既存ハッシュとも一致した。**Git blob IDそのものをSHA-256扱いしていない**。バイト取得ができないgzip保存版はPASSに含めない。

1. [v4入力・観測ログ検査票](v4-input-hash-audit.tsv)：4 journal（計394手）と先行診断2入力、**計6件の全バイトSHA-256が、原`observations.jsonl`第1行のplanに固定された値と一致**。v4 `observations.jsonl` 自体も**1,084,471 bytesを取得**しSHA-256を新規算出：`66cb941288aeca77ee41c3d66c853d420004e3c4b474ada5c612c24017d4afa6`。比較する事前の期待値はなく、この1件の判定は `COMPUTED_NO_PREVIOUS_EXPECTATION`。
2. [99ソースの実測SHA-256対照表](source-hash-audit.tsv)：固定版の99 Git blobを再取得。**95件は原rawと一致しないが、CRLFをLFへ正規化した内容のSHA-256はv4の`source-provenance.json`と一致**（`LF_PASS_RAW_DIFF`）。**4件は現行固定版のLF内容も当時の記録と異なる**（`CONTENT_DIFF`）。取得失敗0、未照合0。
3. `CONTENT_DIFF` 4件は `scripts/benchmarks/gameBlunderPilot.ts`、`scripts/benchmarks/gameBlunderInvestigation.ts`、`scripts/investigate-game-blunders.ts`、`scripts/summarize-game-blunders.ts`。いずれもv4テストの `historicalSources` 集合に一致し、テストは `docs/benchmarks/game-blunder-review-20261111/baseline-sources/<basename>.gz` の履歴保存版を参照する。2026-11-24時点ではバイナリ取得に接続側のUTF-8制限があった。
4. 原`observations.jsonl`のplanから `paths`（4 journal）、`priorFile`、`v3File`、`sourceHashes`（99エントリ）を直接読取り。先行2件のSHA-256は `priorHash`、`v3Hash` と照合。単なるソース中の文字列探索や事後の説明だけに依存していない。

2026-11-27の読戻しでは、PR #218の固定Git blobから履歴保存版gzip 4件を取得・解凍した。LF正規化後のSHA-256は4件一致、展開直後のSHA-256は3件一致。`gameBlunderPilot.ts.gz` の展開結果は実験時raw SHA-256と異なる。元の99ソース照合表は固定版ソースを対象とし、実験時の全99ソースのraw同一性は未確定。

## W1制御・専用CIの依存審査
[追加分類票](w1-ci-dependency-addendum.tsv)は[228パスの基礎台帳](dependency-ledger.tsv)に適用する。PR #218固定HEADのW1専用CIは**15ファイルを直接起動**する。従前の追補で直接起動12件と補助コード11件を `UNDETERMINED → KEEP` とした。直接起動の `stage-w1h-entry-check.mjs` と `stage-w1i-public-log-gate.py` は基礎台帳ですでに `KEEP`。直接起動の `stage-w1j-auth-check.mjs` と、その静的import先 `stage-w1j-auth-contract.mjs` は追加分類票で `RESEARCH → KEEP` に訂正した。**25件の差分のうち13件が直接起動分**。W1jの両ファイルをShogi-Appの検証経路に保持し、汎用研究は引き続きLab Issues #1〜#4で扱う。

v4統合テストの実行時入力33件は基礎台帳で `REFERENCE → KEEP` に訂正した。[台帳README](README.md)に読取経路を記載する。

| 区分 | 訂正前の有効分類 | 訂正後の基礎台帳 | 訂正後の有効分類 |
| --- | ---: | ---: | ---: |
| KEEP | 131 | 141 | **166** |
| REFERENCE | 54 | 21 | **21** |
| RESEARCH | 2 | 2 | **0** |
| UNDETERMINED | 41 | 64 | **41** |
| 合計 | **228** | **228** | **228** |

未判定41件には過去の収録・preflight・snapshot・観測・preservation補助コードやW1i原票保全テストが含まれる。7診断テストと今回見たW1専用CIの直接・間接呼出しのみでは削除・汎用移管の可否を保証できないので、そのままにした。

## 判定・保全
- **限定結論：** v4の動的入力6件の全バイト同一性PASS、v4観測ログの独立SHA-256算出、99現行ソースの95件LF内容一致／4件履歴相違。依存分類の訂正後に基礎台帳と追加分類票を適用すると、v4の実行時入力とW1専用CIの直接起動15件はすべて `KEEP` となる。
- **未完了：** 99ソース全ての実験時raw同一性、W1未判定41件の他入口／履歴依存審査、全再帰importの網羅性。
- **不変：** PR #218はDraft・マージ推奨NO、比較ゲートは `BLOCKED`、`permit=false`、正式旧0／新0、S4/S5 `NOT_TESTED`、R8/H1〜H4 `UNKNOWN`。新しい比較実行は行わない。履歴、元原票、既存保存物を削除・移動・上書きしない。分類表の追補は元の独立レビュー完了を意味しない。
- **次の工程：** 未判定41件はStage W1 runnerの過去起動・証拠の再集計からの参照も確認し、検証できた行を別追補へ追加する。
