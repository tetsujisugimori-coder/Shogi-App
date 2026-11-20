# Stage W1j 独立source seal認証の成立性（合成検証限定）

## 現行判定
**総合PARTIAL／結果B。固定旧新版の正式比較は旧0／新0、開始BLOCKED。S4/S5 NOT_TESTED、R8/H1〜H4 UNKNOWN、Draft維持、マージ推奨NO。**

開始HEAD：7baa4c64ee53530161f81029c7e0c978396c6213。W1iのP3-W1i-01／02は固定HEADの独立再レビュー #5984342861 で限定CLOSED。承認済みcloud117＋Windows185＝302件の保全限定PASSは維持。対象外Windows29件の追加保存・調査は不要。歴史的公開path2件の別P3はOPEN維持。

## 今回の実装
W1hが既に作成できるsealのバイトを「別の主体による観測証言」に結び付ける前段として、**発行者と観測者の2役が独立署名したchallenge/observationの検証契約**を、合成入力のみで試す。

- scripts/stage-w1j-auth-contract.mjs：固定順序のフィールド、発行者／観測者別のドメイン分離したEd25519署名、署名者識別、HEAD順序・source digest・seal raw SHA-256、nonceと時刻、再利用検査を扱う。
- scripts/stage-w1j-auth-check.mjs：エフェメラルな別々の鍵をその場で生成し、正常1、故障20、実比較ゲートの拒否1、計22件を試す。鍵はGit・CI artifact・logには保存しない。
- 既存のstage-w1g-gate.mjsと製品コードは**変更しない**。合成契約がPASSでも返り値はoperationalGate=BLOCKED、permit=false、比較0／0。実運用を無条件READYへ変更する経路は増やさない。
- 仮のnonce既使用Setはテスト呼出し元の入力であり、外部で真正性を担保した使用済み台帳ではない。コード内の公開鍵も実運用上の信頼元ではない。

## 独立性を証明できない理由
署名の検証は「ある鍵による宣言と、その宣言した内容の対応」を検証するだけ。測定対象と同じプロセス／所有者が鍵を作り、任意の報告へ署名してしまえば、**その内容を本当に読み・利用したか**は証明できない。

| 開始条件 | W1j時点の判定 | 実開始前に必要な根拠 |
| --- | --- | --- |
| 署名・nonce・raw bytesの結合 | SYNTHETIC_PASS | 実証環境での独立検査 |
| trusted issuer／observer | BLOCKED | 計測プロセスと権限・鍵管理を分離した信頼元 |
| nonceの発行・使い切り | NOT_ESTABLISHED | 外部で固定された時計と耐障害・排他的台帳 |
| 実sourceのread／use | UNKNOWN | 検査対象の自己申告ではない観測 |
| OS/native/worker来歴・排他writer・atomic rename | UNKNOWN | 許可されたOS観測手段・欠測・主体結合 |
| Vitest結果cache・全実効config | UNKNOWN | 同等性または隔離の独立検査 |
| 比較開始承認 | BLOCKED | 全必須条件と別途の所有者承認 |

## 試験・限界
Node.jsの標準ライブラリのみを使用。外部依存、製品コード、既存原本の変更なし。

専用CIで次を実行する：

    node --test scripts/stage-w1j-auth-check.mjs

ローカルの事前合成試験22/22 PASSは、既存stage-w1g-gate.mjsを模した**ローカル限定stub**を使ったものであり、実GitHub版との統合PASSとは数えない。stubはGitHubへ提出しない。専用CIのGitHub checkoutでは本物の既存ゲートを読み込み、比較BLOCKEDを実測する。最終HEADのCI結果はPR追補で確認する。

新規独立主体／永続台帳の権限、実行・ファイル観測、出力保全には今回着手せず、認可・可用性が確認できるまでBLOCKEDとする。**本工程の合成PASSを正式比較の許可、証拠の真正性保証、棋力改善の証明に転用しない。**

## 次の限定工程候補
実施するなら、独立した発行／観測主体と、外部所有の信頼鍵／nonce台帳が許可された環境で実際に構築できるかを調べる。横断研究git-preservation-gateとの役割分担を守り、再び同じ観測・保全の証明を別repoで過剰に繰り返さない。未成立なら結果Bとして安全停止、正式比較旧0／新0・Draft・マージNO維持。
