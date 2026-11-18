# W1i 公開表現と未加工原票の監査

開始対象は `1b4b17d90ff58db576585cc0151f5c53354a9d36`。W1hのpublication-redactions.jsonは変更しない。

## 実物と範囲
独立Bは台帳の4原票について、GitHub固定版の公開byteと私有未加工原本を直接読み取った。raw登録SHA 4/4、public登録SHA 4/4、宣言された作業path置換による全byte対応4/4が一致。公開版4件の作業path残存は0。限定されたcredentialパターン検査も0件であった。これは全種類の秘密を自動否定する証明ではない。

`fdf40185ea91e9c50beaed02f7bc1c4f2bcafae4` の `seal/red.stdout` と `seal/oid-coercion-red.stdout` は未加工原本と一致し、旧作業path表現がGit履歴から現在も取得可能。現在の訂正と過去の公開は別であり、消去済みとはしない。force-push、Git履歴書換え、原票変更は行わない。

## 影響
確認できた露出は合成検査のスタックトレースに含まれる作業領域構造。作業path単独は認証情報や外部からファイルを開けるアクセス鍵ではない。今回確認した4原票から資格情報・秘密実験本文の混入や実害を示す証拠は確認していない。個人情報漏洩・重大事故と断定しない。

## 判定
現行公開表現の整理はPASS。未加工原本は本人限定Libraryへ別保存し、raw/publicのSHAと対応を保持する。P3の「履歴から完全消去」は未成立なので全体を無条件CLOSEDとはしない。**公開path P3 OPEN（低影響・履歴残存を明示した管理上の残件）**。比較ゲートや製品安全のFAILに伝播させない。履歴書換えを次工程の自動必須条件にしない。

## 再混入防止
`stage-w1i-custody-check.py` のpublic_text_checkと合成正常/故障テストで、代表的なcloud/home/Windows作業pathとcredential形式を拒否する。これは限られた文字列lintであり、任意の秘密を保証するDLPではない。公開物は手動内容審査も併用し、元rawを置換せず公開派生版だけを作る。
