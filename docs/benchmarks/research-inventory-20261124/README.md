# 第1期｜悪手診断7テスト起点のパス単位依存台帳

作成：2026-11-24 JST。Shogi-App [Issue #221](https://github.com/tetsujisugimori-coder/Shogi-App/issues/221)、[Draft PR #218](https://github.com/tetsujisugimori-coder/Shogi-App/pull/218)の**固定HEAD** `ad82e73a3f9d72f860a8f4df0e10f525cdc77a33` を参照する。比較基準main：`85d856b9bc6b7939977cdb2867f2cff3a84a9025`。本台帳の提出先は別の文書専用Draft PR #222。

## 集計
- [機械可読TSV](dependency-ledger.tsv)：**228個の重複しないパス**（KEEP 108、REFERENCE 54、RESEARCH 2、UNDETERMINED 64）。
- 診断テストのroot：**7ファイル**。v4の`source-provenance.json`が記録するソース：**99ファイル**。W1系制御/研究スクリプト・専用CI：**72ファイル**（根拠未確認のものを無理に移管判定しない）。
- Git tree API `recursive=1` は `truncated=false`。99ソース・7テストの固定HEAD存在は確認。0件の台帳パスがGit tree上で不存在（詳細はTSV `MISSING_AT_FIXED_HEAD` を参照）。**この集計は全4,168変更ファイルの個別内容審査とは異なる**。

## 判定と検証水準
- **KEEP**：7テストが直接用いる診断コード・共同棋譜基盤・将棋エンジン、再計算に必要な実測・入力・保存版4ソース、比較拒否を担う現行ゲート。現在の配置を保持する。製品ソースは主として既存mainのものであり、PR #218で変更したとの意味ではない。
- **REFERENCE**：v4当時のソース集合のうち直接実行依存のない比較資料、CI失敗を含む検証ログ、証拠の補足文書。**元保存先・Git履歴の保持が必要であり、削除/移動を承認した区分ではない**。
- **RESEARCH**：現時点ではW1j合成署名契約2件をLab研究課題に対応付ける。**ソースコード自体の移動済みを意味しない**。依存する現行ゲートはShogi-Appの管轄。
- **UNDETERMINED**：7テストへの明示的直接参照を認定できないW1の制御・観測・実験コード。役割調査・既存CIの呼出し・実行ゲート検証まで変更しない。
- `git_blob_sha1` は固定Git treeに存在するGit blob IDであり**SHA-256ではない**。`v4_experiment_raw_sha256` / `v4_lf_sha256` はv4の既存`source-provenance.json`から転記した**保存記録値**。今回新しくSHA-256を再計算したとの主張はしない。`RECORDED_SHA256_NOT_REHASHED` と `TREE_ONLY` を区別する。旧4棋譜のSHA-256もv4 READMEの記録値。
- `MISSING_AT_FIXED_HEAD` は `UNDETERMINED` に強制変更し、想像上のパスをKEEPにしない。大きなJSONL・gzipの全byte再取得／再ハッシュ、静的importの**全再帰グラフ**、npm実行・CI追試は未実施。Workによる99ソース・4journal等のハッシュ一致報告は別担当の観測であり、今回の独立実測と混ぜない。

## 7テストからの直接依存（コード監査）
| テスト | Shogi-Appに残す直接参照の要点 | 保存された入力・出力 |
| --- | --- | --- |
| `game-blunder-diagnosis.test.ts` | Pilot、Diagnosis、交換・静止探索・戦術局面fixture、合法手・詰み判定 | 人工局面が主 |
| `game-blunder-fixed.test.ts` | Fixed、Diagnosis、matchJournal、合法手・戦術局面 | 人工局面が主 |
| `game-blunder-investigation-integration.test.ts` | 旧summarize、journalIO | 20261030の`observations.jsonl`、`summary.json`、summaryが指定する4journal |
| `game-blunder-investigation-v4.test.ts` | Investigation、v4 summarize、Fixed、Pilot、matchJournal、合法手・探索・診断計測 | 人工局面・固定時計 |
| `game-blunder-pilot.test.ts` | Pilot、matchJournal | 20261026 `fault-fixtures-final` の2JSONL |
| `game-blunder-timeout-integration.test.ts` | Fixed、探索結果型 | 20261030 `observations.jsonl` |
| `game-blunder-v4-journal-integration.test.ts` | v4 summarize、Investigation、journalIO、matchJournal、Pilot、合法手 | v4 `observations.jsonl`／`summary.json`／`source-provenance.json`、4journal、先行2データ、99ソース、旧4ソースgzip |

**直接importのない依存**も注意：v4の`plan.paths`、`plan.priorFile`、`plan.v3File`、`plan.sourceHashes`は保存ログ内で決定する。固定ファイル名のgrepだけでは抜ける。v4の原記録は1,084,471 bytes、今回その全行を独立読取りしたわけではない。先行2入力の正確なSHA-256は原`plan`の`priorHash`／`v3Hash`と照合すべきで、Git blob SHAのみで代用しない。

## 受入の境界と次の判断
1. KEEPの診断4モジュール／共通journal／7テストと、実験証拠・過去ソースの**現配置を保つ**。現時点で移動・削除・上書き・履歴修正はしない。
2. 原v4`observations.jsonl`内の動的パスと99ソース、旧4gzipを**独立再取得・全byte/SHA-256**で再照合する工程は未完了。該当値が取れない場合は停止・UNKNOWNとする。
3. UNDETERMINEDのW1スクリプトは、診断7テストだけでなく、W1専用CI・安全停止ゲート・公開ログ検査からの呼出しを追跡してから個別に分類する。
4. 汎用課題は[execution-trust-lab移管表](https://github.com/tetsujisugimori-coder/execution-trust-lab/blob/19024311f9547d337b1a688e4f7c54bd7676dbeb/docs/shogi-app-transfer.md)およびIssues #1〜#5と対応付ける。合成認証を実用認証の成立とみなさない。
5. PR #218は**Draft・マージNO**、正式旧新版比較は**旧0／新0**、開始`BLOCKED`、`permit=false`を維持する。この台帳は比較開始許可ではない。中央保全規約v0.2.0に従い、元原票・履歴を不変とする。

今後の分類更新時は固定HEAD、同一パスのblob/記録SHA、参照したテストまたは記録根拠を併記する。未検証をPASSへ読み替えない。
