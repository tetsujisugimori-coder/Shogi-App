# Stage W1i 原票救済・公開記録整理

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

次の最小工程は、対象外29件等の必要性を判断し必要なものだけ保存範囲を拡張すること。公開pathの履歴残存を受け入れるかは独立した情報取扱判断であり、比較起動とは別。追加の再実測は今回不要。
