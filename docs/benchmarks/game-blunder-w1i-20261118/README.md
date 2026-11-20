# Stage W1i 原票救済・公開記録整理

## HEAD別の確認済みCI判定（2026-11-20追補）
**総合B／PARTIAL。指定302件の保全は限定PASS。旧Windows29件はOUT_OF_SCOPE、追加調査・保存は不要。比較開始BLOCKED、正式旧0／新0、Draft維持・マージ推奨NO。**
- **当初W1i固定HEAD `b1132523fbd82e603877e153846d6ff20e8fcc3f`：** [製品CI #44337930402](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44337930402) FAILURE（Ubuntu成功、macOSはhosted runner取得前にキャンセル・テスト未実行）。[専用CI #44337935698](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44337935698) SUCCESS。これは当時の記録。
- **独立再審査済み固定HEAD `d471fe3d8d88efbe0f8ea61c620718b6cb897ac5`：** [製品CI #44537048487](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44537048487) SUCCESS（Ubuntu 2,587 PASS、macOS 2,585 PASS＋2 SKIP）。[専用CI #44537048476](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44537048476) SUCCESS。[限定独立レビュー #5978038005](https://github.com/tetsujisugimori-coder/Shogi-App/pull/218#pullrequestreview-5978038005)。
- **以後の修正HEAD：** この文書は将来のCI成功を先取りしない。実際の最新HEADのCIは[PR Checks](https://github.com/tetsujisugimori-coder/Shogi-App/pull/218/checks)と新たな結果報告で確認する。下記の「現行」「最新」は**それぞれの作成当時における判定記録**であり、この版別記録に優先しない。
- 現行公開ログ4件の訂正は維持。歴史的公開ログ2件はGit履歴に残り、公開pathの既存P3はOPEN。原本保存・歴史コミットは変更しない。

## 2026-11-19 旧固定HEADのCI・公開ログ記録（当時の判定）
**Stage W1i：結果B／PARTIAL。承認済み302件のLevel 2原票保存と独立再取得は限定PASS、比較開始BLOCKED、正式旧0／新0、Draft維持・マージNO。** 旧Windows29件は承認対象外（OUT_OF_SCOPE）であり、本件の追加保存・調査は要求しない。
最終提出HEAD `b1132523fbd82e603877e153846d6ff20e8fcc3f` の[正式CI #44337930402](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44337930402)は **completed/failure**。UbuntuはSUCCESS（2,587 PASS）、macOSはジョブ `134919598366` が **cancelled、0 steps、runner_name空欄**。当該macOSのテスト結果はNOT_TESTED、根本原因はUNKNOWN。[専用CI #44337935698](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44337935698)はSUCCESS。GitHub当該runの開始/終了は2026-11-18 15:38:15〜15:53:19 UTC。約15分後に割当ランナー・ステップがなく終了したため、runner割当/起動段階の問題を強く示すが、診断annotation本文を取得できておらず断定しない。[調査記録](macos-ci-cancel-investigation.md)を参照。過去の「CI確認待ち」は提出当時の履歴であり現行状態ではない。
現在公開されるW1hの4ログはpath置換済み、原本は承認済み保存領域に保持。現在の4ログへの作業path再混入を専用CIの読取専用 `stage-w1i-public-log-gate.py` で拒否する。過去commit `fdf40185` の2ログは、後続commitだけでは変更できない不変のGit履歴に残る。**歴史的2件は消去できたと主張せず公開path P3 OPENを維持**し、force-push・歴史書換え・原本削除を行わない。[対応範囲](publication-audit.md)を参照。
この追補を含む新HEADのCI結果は別途確認すること。旧HEADの正式CI失敗が新HEADのCI実測成功に置換されたわけではない。

**総合結果B / PARTIAL、比較開始BLOCKED、正式旧0／新0、S4/S5 NOT_TESTED、R8/H1～H4 UNKNOWN、マージ推奨NO、Draft維持。**

開始HEAD `1b4b17d90ff58db576585cc0151f5c53354a9d36`、tree `6261aba336d09a0a1e8087f4dbbdf85d70979075`、base `85d856b9bc6b7939977cdb2867f2cff3a84a9025`。指定と一致。PR #218 OPEN/Draft。W1h最終コードからの差分は文書2件へ計11行追加のみ。開始HEADの正式CI/専用CIはsuccess。新提出HEADのCIは投稿後に別途確認する。

## 実保存
所有者の本件承認を確認して、非機密W1h原票クラウド117件 / 641,330 bytes、Windows185件 / 142,620 bytesとmanifest・監査票を本人限定Libraryへ2つの新規ZIPとして保存した。既存原本は改変・移動・削除せず、過去の実行を再現して代替原票にはしていない。

クラウドZIP209,585 bytes / 118 entries、Windows ZIP98,796 bytes / 187 entries。保存receiptは私有領域へ保持し、公開記録には内部保存ID/取得URLを載せない。各SHAと構成は[preservation-manifest.json](preservation-manifest.json)。別担当BがLibraryから別領域へ新たに取得し、両ZIPのCRC、危険path・重複0、manifestの集合・size・SHAを独自検算した。Bはcloud ZIPと原117件、Windows元ZIP全byteおよびlive原185件の全byte一致も確認した。全byte確認範囲は[retrieval-verification.json](retrieval-verification.json)参照。SHA文字列一致を元byte比較に置換しない。

**訂正:** 旧「Windows185件/36,882bytes」の36,882はmanifestそのもののサイズ。185対象ファイルは142,620 bytes。元manifest SHAは `69cfa11128b10b0ceba16ccef04ec411fd951eb8d399ba41dd93a789b4ab310c` と実物一致。旧報告を改竄せず本記録で訂正。

旧214件のうち今回185件に含まれない29件は保存承認対象外で、既存の場所に保持し今回の追加Library保存はNOT_TESTED。合成fixtureやGit clone全体は今回の原票集合監査対象外。全過去資産の網羅性をPASSとはしない。

## 公開版との関係
クラウド保存物のW1h文書/原票58件のうち56件は開始HEADと全byte一致。READMEとINDEPENDENT-REVIEWはタイトル直後の現行状態notice挿入のみで旧行を保持するが、文書全体が連続した一つの旧byte spanとして残るわけではない。旧「全byte連続」表現をこの点で訂正する。[関係票](historical-github-relationship.json)。

公開path監査は[publication-audit.md](publication-audit.md)。現在の公開4件は訂正済み、raw/public SHAと置換対応一致。ただしGit履歴内2件の旧表現は現存。実害・資格情報漏洩を示す証拠は確認していない。P3全体は低影響の管理残件としてOPENとし、完全消去を主張せず、履歴書換えを自動要求しない。

## 試験・レビュー
新Python helperは `w1i-custody/1`（クラウド束）のオフラインZIP/receipt/publication lintのみ。Windows束の旧manifest形式はBの別検査器で検算しており、全形式にこのhelperが対応したとはしない。保存や比較を起動せずpermit=false。初回21合成テストPASS。Bの独立12反例でcanonical pathのP3が見つかり、空または`.` path成分を拒否する補訂を行った。最終23テストPASS/FAIL0/skip0/exit0。期待した拒否は故障データの受入成功ではない。旧ログとREDは保持する。

Linux既存225合成回帰PASS/FAIL0/skip0/exit0。製品テストは今回再実行しておらず、W1h結果を新たな実測として数えない。OSの本物ACL拒否/保存容量不足やサービス保持保証の試験はNOT_TESTED。欠測・保存失敗・権限拒否は合成状態での安全停止検査。

独立性は別担当・別セッション・別取得/検証領域だが、同一所有者・アカウント・基盤を共有。第三者人的独立監査ではない。[レビュー](independent-review.md)。新HEADの固定Git実体再取得、CI結果、正式レビューURLはPR/Issueの提出後追補を参照する。

## 保持する制約
W1g P2/P3の限定CLOSEDとW1h文書指摘の修正を維持し、本工程によって比較開始を許可しない。製品探索/評価/規則、timeout5000ms、worker2、package/依存/workflow、旧原票は変更しない。保存PASSはACL全体・長期保持・歴史的真正性PASSではない。

【当時の提案・現行の対象外29件には適用しない】次の最小工程は、対象外29件等の必要性を判断し必要なものだけ保存範囲を拡張すること。公開pathの履歴残存を受け入れるかは独立した情報取扱判断であり、比較起動とは別。追加の再実測は今回不要。
