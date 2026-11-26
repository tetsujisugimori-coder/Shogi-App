# 第1期｜Shogi-App研究資産の棚卸しと責務分離
記録日：2026-11-23 JST。これは**分類・参照台帳**であり、コード移植、原票移管、比較開始承認、PR #218の受入判定ではない。

## 1. 固定対象と判定
- 起点：[Shogi-App Issue #221](https://github.com/tetsujisugimori-coder/Shogi-App/issues/221)、悪手診断 [Issue #217](https://github.com/tetsujisugimori-coder/Shogi-App/issues/217)、[Draft PR #218](https://github.com/tetsujisugimori-coder/Shogi-App/pull/218)。
- 比較対象：main `85d856b9bc6b7939977cdb2867f2cff3a84a9025` → PR #218 HEAD `ad82e73a3f9d72f860a8f4df0e10f525cdc77a33`（PR側tree `162055333aab144ec1279ff915e94d1db68cc347`）。
- PR #218はopen/Draft、25コミット、4,168変更ファイル。**PARTIAL／結果B、マージ推奨NO**。source sealの合成署名検証は限定PASSだが、実運用の独立認証は `BLOCKED`、`permit=false`。固定旧新版の**正式比較は旧0／新0、開始 `BLOCKED`**。S4/S5 `NOT_TESTED`、R8/H1〜H4 `UNKNOWN`。
- 歴史証拠、旧HEADのCI、レビュー、限定受入条件は書き換えない。旧CI成功を新HEADの検証結果として使わない。

## 2. 全変更ファイルの機械的棚卸し
Gitの2つの固定treeから通常blobのpathとSHAを列挙し、path集合の和集合について、存在しないものとSHAの異なるものを差分として数えた。**追加4,164、変更4、削除0、合計4,168**。次のルールは**上から先に一致したもの**を採用するため重複計数しない。

| 区分 | path条件（概略） | 件数 | 現時点の扱い |
| --- | --- | ---: | --- |
| W1b〜W1jの履歴資料・原票 | `docs/benchmarks/game-blunder-w1[a-j]*` | 3,728 | Shogi-Appの元証拠・履歴として保持 |
| W1 Windowsの資料・原票 | `docs/benchmarks/game-blunder-windows-stage-w1*` | 195 | Shogi-Appの元証拠・履歴として保持 |
| W1スクリプト・専用CI | `scripts/stage-w1*`、`.github/workflows/stage-w1*` | 72 | 実行ゲート・ランナー依存を個別に評価。現状は保持 |
| 悪手診断本体のコード・資料 | 上記以外でpathに `game-blunder` | 162 | 将棋の診断・テスト・記録として保持 |
| その他の研究スクリプト | 上記以外の `scripts/*` | 8 | 将棋の診断・比較用途として保持 |
| その他 | 上記以外 | 3 | `.gitattributes`、`.gitignore`、`LOG.md`。既存の意味を保持 |
| **合計** | | **4,168** | |

> **分類上の限界：** 全4,168パスが大区分に入ったことは検証できる。一方で3,728件の全内容を個別読解して「Lab移管可能」と認定したものではない。原票の件数と、承認された長期保存対象の件数は別のもの。パス分類はマージ・削除・移管の許可ではない。

## 3. Shogi-Appに保持する責務（A）
将棋のアルゴリズム構成を証拠で比較し、採用判断を行うことが製品側の中心課題。関連資産は次の通り。
- **対局・局面の識別：** 4 journalと局面、root合法手、実手・代替手、棋譜の同一性、局面の再構築と合法性照合。
- **棋力診断：** 探索深さ、通常探索・静止探索、SEE、手の順序、TT/killer、評価値・PV・停止理由、node/enter数、旧疑い局面の再集計。代表資料の[悪手診断v4](https://github.com/tetsujisugimori-coder/Shogi-App/blob/ad82e73a3f9d72f860a8f4df0e10f525cdc77a33/docs/benchmarks/game-blunder-investigation-v4-20261105/README.md)はPR #218の固定HEADを参照する。
- **比較の再現性：** 順序付き旧新版HEAD/tree、source/依存/lock/実効設定、同一予算、一要因の差、試行ID、反復順序、独立した再集計、正常・無効・破損・中断・未実行の区別。
- **Windows/Vitest固有の診断・受入：** 既定5秒・2workerの不変、cache初期状態・隔離・キューへの影響、Windowsの時間切れと既存テストの原因隔離。該当するStage W1b〜W1fとW1専用CIは、当面Shogi-Appから動かさない。
- **開始と採否：** `stage-w1g-gate.mjs`等の既存拒否経路、製品回帰、比較開始ゲート、棋力向上の受入判断はShogi-Appに残る。Labの検証が成功しても自動解除しない。

将来の研究方針は、**まず複数アルゴリズムと組合せの中から全体的に優れた構成を証拠で選ぶ。その後、局面に応じて構成を選び分けるC方式へ発展させる**。第1期は研究資産の整理であり、棋力改善済みの宣言や探索パラメータ変更は行わない。

## 4. execution-trust-labに分離した汎用研究（B）
既にLab側に登録された論点を再作成せず、研究の正本を参照する。
| Lab Issue | 主な研究 | Shogi-Appとの境界 |
| --- | --- | --- |
| [#1](https://github.com/tetsujisugimori-coder/execution-trust-lab/issues/1) | 合成Ed25519署名・source seal、実験0001 | W1jの合成契約を参照するが、将棋の正式比較を許可しない |
| [#2](https://github.com/tetsujisugimori-coder/execution-trust-lab/issues/2) | 対象バイト・sealと実際の読取り／意味的使用の証拠 | Shogi側は対象同一性と開始拒否を管理 |
| [#3](https://github.com/tetsujisugimori-coder/execution-trust-lab/issues/3) | 発行者・観測者・検証者、信頼元、鍵管理 | 合成別鍵と、運用上の主体独立を同一視しない |
| [#4](https://github.com/tetsujisugimori-coder/execution-trust-lab/issues/4) | 永続nonce台帳、競合・再起動・失効 | W1jの一時的な使用済みSetを運用保証としない |
| [#5](https://github.com/tetsujisugimori-coder/execution-trust-lab/issues/5) | OS/native/worker・ファイル操作・writer/rename来歴 | W1g〜W1fのNode観測がOS全体の証明であるとは主張しない |

- [Lab移管表](https://github.com/tetsujisugimori-coder/execution-trust-lab/blob/19024311f9547d337b1a688e4f7c54bd7676dbeb/docs/shogi-app-transfer.md) はW1g〜W1jを工程別に対応付け済み。
- 研究基盤と合成実験0001はLabのmainへマージ済み。実鍵と実OS来歴の立証は引き続き研究課題とする。[Lab PR #6](https://github.com/tetsujisugimori-coder/execution-trust-lab/pull/6)
- 現時点で**Lab側へ移管したのは研究課題・参照・合成実験**。Shogi-Appの既存原票・コード・署名鍵・Gateを移動済みとは扱わない。

## 5. 共通部分（C）の所有権と証拠参照
| 共通要素 | Shogi-Appが管理すること | Labが研究すること |
| --- | --- | --- |
| source seal | 比較対象HEAD/tree、原バイト固定と不一致時拒否 | 署名と対象読取・使用・独立検証をどう結ぶか |
| 実行条件 | Node/Vitest/OS、設定、worker、cache、予算・局面 | OS上の実行主体・ファイルの来歴、観測欠測 |
| 結果保存 | 原票、manifest、独立読戻し、既存保全判断の履歴 | 真正性と保存後バイト一致の違い、追加の観測契約 |
| 安全停止 | 既存ゲートを保持、正式比較起動を拒否 | 各研究結果も `permit=false` を維持 |

W1iで**承認された302件の保全限定PASS**は維持し、クラウド117件・Windows185件の別を残す。旧Windows29件は`OUT_OF_SCOPE`で追加調査・保存の対象にしない。歴史的な公開ログ2件のP3は`OPEN`として履歴を維持し、消えたとは主張しない。保全規約と実認証の研究を混同しない。元原票の移動・削除、歴史書換え、force-push、無断の再保存は行わない。

## 6. 次の小規模工程と判断点
1. **棚卸し文書・台帳・追補を別Draft PRとして提出。** 固定HEADの独立レビューで分類とリンクの妥当性を確認する。PR #218とLabの研究記録は元の管理先で扱う。
2. **比較仕様の独立した小PR：** 将棋固有の「候補アルゴリズム構成・比較指標・選定基準」を定義する。現行ゲートを迂回せず、実比較は起動しない。
3. **実装の分割設計：** W1b〜W1fの必要最小限の診断・集計と、W1g〜W1jの研究用観測を「依存がある／参照で足りる／未判定」に切り分ける。必要なら別Issueで個々のコード候補を審査し、コード削除・移植は承認を分ける。
4. **将来の比較開始判断：** Shogi-Appの全必須条件、正式CI、独立レビュー、所有者承認が揃うまで `BLOCKED`。研究台帳の完成を解除条件にしない。

### 今回の不変条件
- 製品の探索・合法手・評価、`package.json`、lock、既定5秒・2workerを変更しない。
- PR #218の25コミット・歴史4,168差分・原票・判定・既存ゲートを変更しない。
- 実比較旧0／新0、`permit=false`、`BLOCKED`、Draft維持、マージ推奨NOを引き継ぐ。
- この分類は**設計上の責務分離**であり、実認証成立、性能向上、マージ可否の再判定ではない。
