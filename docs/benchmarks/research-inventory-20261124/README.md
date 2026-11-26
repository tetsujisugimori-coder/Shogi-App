# 第1期｜悪手診断7テスト起点のパス単位依存台帳

作成：2026-11-24 JST。Shogi-App [Issue #221](https://github.com/tetsujisugimori-coder/Shogi-App/issues/221)、[Draft PR #218](https://github.com/tetsujisugimori-coder/Shogi-App/pull/218)の**固定HEAD** `ad82e73a3f9d72f860a8f4df0e10f525cdc77a33` を参照する。比較基準main：`85d856b9bc6b7939977cdb2867f2cff3a84a9025`。本台帳の提出先は別の文書専用Draft PR #222。

## 集計
- [基礎台帳TSV](dependency-ledger.tsv)の**228個の重複しないパス**に[W1専用CIの追加分類票](w1-ci-dependency-addendum.tsv)の `new_decision` を適用する。有効分類は **KEEP 166、REFERENCE 21、RESEARCH 0、UNDETERMINED 41**。基礎台帳に記載されたW1j 2件の旧分類は追加分類票で更新する。
- 診断テストのroot：**7ファイル**。v4の`source-provenance.json`が記録するソース：**99ファイル**。W1系制御/研究スクリプト・専用CI：**72ファイル**（根拠未確認のものを無理に移管判定しない）。
- Git tree API `recursive=1` は `truncated=false`。99ソース・7テストの固定HEAD存在は確認。0件の台帳パスがGit tree上で不存在（詳細はTSV `MISSING_AT_FIXED_HEAD` を参照）。**この集計は全4,168変更ファイルの個別内容審査とは異なる**。

## 判定と検証水準
- **KEEP**：7テストが直接用いる診断コード・共通棋譜基盤・将棋エンジン、再計算に必要な実測・入力、比較拒否を担う現行ゲート、W1専用CIの実行依存。v4統合テストが来歴照合で開く95ソースの現配置と、4ソースに対する履歴保存版gzipを保持する。製品ソースは主として既存mainのもの。
- **REFERENCE**：v4当時のソース集合のうち直接実行依存のない比較資料、CI失敗を含む検証ログ、証拠の補足文書。**元保存先・Git履歴の保持が必要であり、削除/移動を承認した区分ではない**。
- **RESEARCH**：Labが担当する汎用研究の区分。W1j合成署名契約と検証器の実体は既存W1専用CIの依存として `KEEP`。合成署名の研究課題はLab Issues #1〜#4で扱う。
- **UNDETERMINED**：7テストへの明示的直接参照を認定できないW1の制御・観測・実験コード。役割調査・既存CIの呼出し・実行ゲート検証まで変更しない。
- `git_blob_sha1` は固定Git treeに存在するGit blob IDであり**SHA-256ではない**。`v4_experiment_raw_sha256` / `v4_lf_sha256` はv4の既存`source-provenance.json`から転記した**保存記録値**。今回新しくSHA-256を再計算したとの主張はしない。`RECORDED_SHA256_NOT_REHASHED` と `TREE_ONLY` を区別する。旧4棋譜のSHA-256もv4 READMEの記録値。
- `MISSING_AT_FIXED_HEAD` は `UNDETERMINED` とする。大きなJSONL・gzipの再取得とハッシュの実測結果は[追補](followup-byte-ci-audit-20261124.md)に記録する。静的importの全再帰グラフはこの台帳の検証範囲外。

## 7テストからの直接依存（コード監査）
| テスト | Shogi-Appに残す直接参照の要点 | 保存された入力・出力 |
| --- | --- | --- |
| `game-blunder-diagnosis.test.ts` | Pilot、Diagnosis、交換・静止探索・戦術局面fixture、合法手・詰み判定 | 人工局面が主 |
| `game-blunder-fixed.test.ts` | Fixed、Diagnosis、matchJournal、合法手・戦術局面 | 人工局面が主 |
| `game-blunder-investigation-integration.test.ts` | 旧summarize、journalIO | 20261030の`observations.jsonl`、`summary.json`、summaryが指定する4journal |
| `game-blunder-investigation-v4.test.ts` | Investigation、v4 summarize、Fixed、Pilot、matchJournal、合法手・探索・診断計測 | 人工局面・固定時計 |
| `game-blunder-pilot.test.ts` | Pilot、matchJournal | 20261026 `fault-fixtures-final` の2JSONL |
| `game-blunder-timeout-integration.test.ts` | Fixed、探索結果型 | 20261030 `observations.jsonl` |
| `game-blunder-v4-journal-integration.test.ts` | v4 summarize、Investigation、journalIO、matchJournal、Pilot、合法手 | v4 `observations.jsonl`／`summary.json`／`source-provenance.json`、4journal、先行2データ、99ソース（うち4件は履歴保存版gzip） |

v4の `plan.paths`、`plan.priorFile`、`plan.v3File`、`plan.sourceHashes` は保存ログで決まる。統合テストは `plan.sourceHashes` の99件を走査し、`historicalSources` の4件は保存版gzipを解凍して、残る95件は指定パスから直接読み込んで照合する。従前 `REFERENCE` だった33件も実行時入力として `KEEP` に訂正した。観測ログと先行入力のハッシュ照合は[追補](followup-byte-ci-audit-20261124.md)を参照する。

## 受入の境界と次の判断
1. KEEPの診断4モジュール／共通journal／7テストと、実験証拠・過去ソースの**現配置を保つ**。現時点で移動・削除・上書き・履歴修正はしない。
2. 原v4 `observations.jsonl` の動的入力と99ソースの照合結果は[追補](followup-byte-ci-audit-20261124.md)を参照する。履歴保存版gzip 4件の読戻し結果を含む。実験時の全99ソースのraw同一性は未確定。
3. UNDETERMINEDのW1スクリプトは、診断7テストだけでなく、W1専用CI・安全停止ゲート・公開ログ検査からの呼出しを追跡してから個別に分類する。
4. 汎用課題は[execution-trust-lab移管表](https://github.com/tetsujisugimori-coder/execution-trust-lab/blob/19024311f9547d337b1a688e4f7c54bd7676dbeb/docs/shogi-app-transfer.md)およびIssues #1〜#5と対応付ける。合成認証を実用認証の成立とみなさない。
5. PR #218は**Draft・マージNO**、正式旧新版比較は**旧0／新0**、開始`BLOCKED`、`permit=false`を維持する。この台帳は比較開始許可ではない。中央保全規約v0.2.0に従い、元原票・履歴を不変とする。

今後の分類更新時は固定HEAD、同一パスのblob/記録SHA、参照したテストまたは記録根拠を併記する。未検証をPASSへ読み替えない。
