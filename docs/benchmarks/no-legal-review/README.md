# PR #182 レビュー性能検証

測定対象はmain `5035a64c702b470b914d49d7eb65519ae5df4bfa`、変更前PR `14b72771b4c4e367d41271e6073c33eff8174617`、修正後 `de3ec93b034ba02043811a60b4577d6b5ebe539e`。最終文書コミットでは製品ソースを変更しない。各JSONのmetadataに実測HEAD・src tree・fixtureハッシュ・時計を保存した。

Windows 10.0.26300 x64、Intel i7-14650HX、24論理CPU、Node v24.20.0、npm 11.17.0。各条件のnpm ci後、同じ凍結fixture・同じハーネスで単独プロセスを順番に実行。測定とテスト/buildを同時実行していない。OSの負荷・電源・JITの完全な制御は保証しない。

[実測集計](summary.md)に全指標を記録。生データはmain/before/after各2巡のJSONとmiddle-*追加比較JSON、全合法手監査はreview-before-audit.json / repo-audit.json。全標本を残し、外れ値を除外していない。

## 条件と再現

各操作2 warmup+5標本を2巡、順序before→main→after / after→main→before。microは100呼出し/標本。固定深さ2と時間制限100/1000ms・最大深さ4を分離。standard手順序、静止探索なし、killerなし、実performance.now時計。0msは回帰テストで検証し、速度比較には混ぜない。

中盤でプロセス間の大きな揺れを観測したため10 warmup+10標本、before→after→mainで追加比較。応手確認は選択した最初の着手後の独立照会であり、探索全体の累積CPU時間ではない。全候補の計測器を製品コードへ埋め込んでいない。

```powershell
npm ci
npx tsx scripts/measure-no-legal-review.ts measure docs/benchmarks/no-legal-review/fixtures.json.gz work/measurement.json label
npx tsx scripts/measure-no-legal-review.ts audit docs/benchmarks/no-legal-review/fixtures.json.gz work/audit.json label
$env:REVIEW_CASE='middle'
$env:REVIEW_WARMUPS='10'
$env:REVIEW_REPETITIONS='10'
npx tsx scripts/measure-no-legal-review.ts measure docs/benchmarks/no-legal-review/fixtures.json.gz work/middle.json label
node scripts/summarize-no-legal-review.mjs docs/benchmarks/no-legal-review
```

比較対象のworktreeへ本PRのハーネスと凍結fixtureをコピーして使用する。環境変数を外せば元の5局面・2 warmup+5標本。generateモードは平手からの合法手順でmiddle/many-handsを一度生成するための補助であり、比較では保存済みfixtureを読み直す。入力の非破壊を各測定・監査で確認する。

openingは平手（30手、持ち駒0）、middleは50手の合法進行後（136手、持ち駒6）、many-handsは98手後（290手、持ち駒19）。few-responsesは両玉・40枚の構成局面で逃げ手1、in-checkは既存の合駒回避fixtureで7手。後二者は平手からの到達を証明していない。各条件で同じfixture・履歴・手番を使用した。

## 判断

初回2巡の中盤固定深さ中央値は変更前156.7ms、修正後257.2msだが、変更前の巡ごとの差が大きい。追加ウォームアップ比較では変更前50.5ms、修正後37.7ms、100msの完了深さは両条件とも全10本で2。単一集計から悪化率や改善率は断定しない。

応手照会は候補ごとに玉安全性を確認し、最初の合法手で戻る。駒打ちも最初の合法な打ち先で戻り、同種持ち駒は当該照会内で一度だけ確認する。元の全列挙・駒打ち検証を共有し、近似・手番間キャッシュはない。少応手・王手局面の応手照会中央値は約0.0097→0.0037ms、0.0094→0.0038ms。副作用のない限定的変更として採用した。評価・手順序・SEE・deadlineの設計は変更しない。

固定深さの全50標本と追加中盤10標本で選択手・評価・PV・訪問数一致。全464合法手の順序・全着手後stateのハッシュも一致。時間制限結果は同じ完了深さで比較可能な98/100標本が一致し、残り2本は比較相手が同深さでないため不一致と断定しない。

100msはopening深さ3、in-check深さ2が各条件全10本で維持。many-handsのfallbackは変更前8/10→修正後5/10。ただしfew-responses修正後2/10は深さ2、変更前は深さ3以上であり、全標本の改善は主張しない。最大wall超過は5局面の修正後100msで1.460ms、1000msで2.537ms。協調的deadlineを維持したがハードリアルタイム保証ではない。追加中盤100msは深さ2が10/10、fallback0、最大超過0.255ms。短時間探索の著しい一貫した悪化は検出していないが、別マシン・実ブラウザの性能は未確認。
