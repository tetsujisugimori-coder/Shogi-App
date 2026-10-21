# TT 2段階照合（2026-10-21 JST）

## 実装前の設計判断

基準main: `f5fdb17c777f34e4db34d903135f6a5dc88e93c9`。GitHub fetch後、PR #196がMERGED、最終実装 `ae8fae547064ff0364a0bb149654e41d7fe71a11`、merge commitが上記mainであることを確認した。元checkoutはclean。branch/worktree一覧を確認し、既存の診断原本とworktreeは変更しない。専用 `codex/tt-two-stage` / `.worktrees/tt-two-stage` を作成した。

README、LOG、PR #196の診断資料、TT/search/test/measure/auditを確認した。公開探索APIの既定OFF・呼出し内所有・opt-in検証・全子exactという保守的保存条件を維持する。

`has→probe` はmiss時の生成を省けるが、hit時にMapを2回検索し、候補確認と厳密照合を別APIに分散する。既存 `probe(key, string)` を維持しつつ `string | (() => string)` を受ける方式を選ぶ。Map.getは1回、候補なしならコールバックを実行しない。呼出し側でidentityをメモ化し、hitの照合済み文字列をexact保存に再使用する。miss後に非exactなら生成せず、exactなら保存直前に1回生成する。コールバック/メモ化の小さい費用は実測対象とする。

厳密identityのbytes、比較、root/ply/depth、履歴上界と全履歴、駒ID/持ち駒順、500手保留、PVヒント、評価/距離/PV複製、killer迂回、FIFO/文字数制限は変更しない。既存中断確認の後にprobeし、時計呼出しを追加しない。hashによる同一性判定は行わない。exact以外の値を保存・再利用しない。

既存統計の意味は維持し、新規カウンターでidentity生成、identity一致/不一致、非exact拒否、サイズ拒否を分離する。時間の細分化は通常経路へ時計を追加せず、診断でprototypeラップを使用する。実測可能な工程と包含関係は後述する。Fは同条件OFFとのノード・qノード差で観測する。通常測定と診断測定を区別する。

## 比較計画

A=固定main TT OFF、B=同main TT ON、C=改善TT ONを同一processで同期直列実行。旧12局面、fixed d4、無期限d1〜4、100/1000ms（最大d4）、小規模局面d5、長い履歴を追加する。各セルwarmup1回＋本測定3回、ABC/BCA/CAB順をローテーションする。深い探索の事前費用をprobeで確認する。生データ、完全state、設定、ソース原本/hash、環境、測定時SHA/diffを保存する。過去の時間値を流用しない。テスト/build/独立参照を測定と並走させない。

決定的OFF→旧main、旧ON→新ONは経過時間以外の結果/ノード/PV/終局距離/既存TT統計を比較する。時限は完了深さとsourceを分離し、完了反復を同設定の無期限探索と比較する。制御時計による期限/partial/fallbackと独立全幅比較も行う。rawからsummaryを再計算し既存summary一致を要求する。

## 実装と統計の定義

`probe(key, string)` を維持し、`probe(key, () => string)` を追加した。単一のMap.getで候補が存在するときだけcallbackを実行する。search側で完全identityを1回だけ生成し、候補不一致後のexact保存にも同じ文字列を使う。候補なし非exactは生成0回。候補なしexactは保存用に1回。既存中断確認の後にprobeする位置、通常探索、exact証明、結果/PV/内訳の複製、容量判定の順序を保持する。

- `lookups = hits + misses`、hitsは粗いキーの候補数、exactReusesは完全一致で省略した件数。既存定義は維持。
- `identityGenerations`: searchが詳細identityを生成した回数（照合＋保存用、memoized再使用は含まない）。直接のtable APIに既に生成したstringを渡した費用は数えない。
- `identityMatches` / `identityMismatches`: probeで完全identityが一致/不一致だった件数。前者はexactReusesと同数。
- `nonExactStoreRejects`: 探索結果が非exactのため保存しなかった件数。
- `sizeStoreRejects`: exact保存を試みたが16,384文字を超過した件数。
- `safetyRejects`: 従来どおりidentity不一致、非exact保存拒否、サイズ拒否、killer迂回の合計。新カウンターで意味を置換しない。

Bは固定mainの製品コードを無変更で実行するため、新しい生成カウンターは計時後に `identityGenerations=lookups`、一致/不一致は既存hits/exactReusesから導出した。Bの非exact/サイズ拒否は通常測定で個別計数しない。同一の決定的条件でB/Cの旧統計全項目が一致することを監査し、拒否理由の内訳はCで観測する。Bに計時用wrapperを加えた値を通常性能へ混ぜない。

## 確定した主測定

測定ソースcommit: `ce4aead9e29ab0c7295005751deb0f33910b4f42`。基準mainは上記f5fdb17。製品/測定CLIのtracked差分は空で固定し、原本gzipとbyte SHA-256をplan/sourcesへ保存。最終HEADの製品/測定CLIの内容一致もauditで確認する。offline audit CLIだけは測定後にmanifestキーをリポジトリ相対パスへ直し、現行テキストとの照合をCRLF→LF正規化した。初回レビューで測定checkoutのCRLF/LF混在により別cloneのbyte照合が失敗すると指摘され修正したもの。測定gzip原本は引き続きraw byte hashで検証し、内容差を許す対象は計時経路外のaudit自身だけ。製品・測定CLI・helper・テストは改行以外の内容一致を必須とする。最終auditの内容hashはmanifestに含める。最終commit SHAとCI対象SHAはPR本文へ記録する（自己参照commitを作らない）。

2026-10-21 **19:42:14〜20:01:49 JST**、Windows 10.0.26300 x64、Intel Core i7-14650HX、Node v24.20.0、npm 11.17.0。正確な環境/全state/設定/実行順は `run1/plan.json`。standard評価・順序、killer=false、PV優先=false、q original+1。基本12局面×4条件＋120手合法棋譜1局面×4条件＋代表3局面fixed d5 = 55セル。各variantにwarmup1回、本測定3回。ABC/BCA/CABの順序位置を本測定内で均衡させ、同期直列、テスト/build/独立参照の並走なし。

**660呼出し＝warmup165＋本測定495、失敗/欠測0**。rawの展開後SHA-256は `ed04aaa845ba04094cc3859443fc0cc1dbf4bfc5fc27cc1be245c3acd3ecafbd`。主測定の時間は今回実行した値のみを使い、PR #196の過去の時間値を流用しない。全標本を保存し、局面/条件の除外なし。

### 正当性

最終通常 `npm run check` は **78ファイル / 2,080テスト、lockfile検証、型検査、production build（1,761 modules）すべて成功**。原本は `validation/final-check.txt.gz`。既存timeout、worker数、assertionは変更しない。

独立レビューの再現性P2は上記の改行正規化で解消し、別LF cloneへ最終監査コード/証拠を配置して660件の再監査・summary/report完全一致・PR #196原本diff=0を実行した（`validation/lf-clone-audit.txt.gz`）。修正後の型検査も成功。製品と測定コードは測定後に変更しない。

`reference.json.gz` の103条件で、基準main OFFと新OFFの全結果一致48件、旧ONと新ONの全結果/旧TT統計一致48件、独立全幅/逆順全幅44条件、PV/killer4組、制御時計7予算を確認した。48件の主比較は同じレコード内で両照合を行う。全幅は限定深さの証明であり、全12局面d4の全幅証明ではない。

主測定はB/Cの決定的全結果/旧統計 **116組**、各variantの時限完了反復と無期限反復prefix **288件**、独立qでのpartial候補再評価 **24件**を照合。全660件の入力非破壊、合法PV再生、末端評価内訳/公開評価/終局距離/理由が一致。fallback実測0件は制御時計のfallback回帰と区別する。NaN、Infinity、千日手/連続王手、500手、FIFO等の対応は [安全条件の検証表](validation/safety-coverage.md)。

### 効率・速度・安定性・容量

全表と機械再集計は [results.md](results.md)、数値原本は `report.json` / `run1/summary.json`。

- 基本12局面fixed d4の生成 **92,766→46,464（49.91%削減）**。fixed＋無期限反復は **208,962→109,977（47.37%削減）**。同じ仕事量で比較した値。exact再利用はfixed 10,359、反復16,086でB/C不変。
- 同12局面fixed＋反復の合計実時間 **259,851.510→257,289.589ms（0.99%短縮）**。fixed単独は **1.98%悪化**、反復は **3.47%短縮**。固定p50は7/12局面改善、5/12局面悪化。mate-sente +4.41%、resistance +4.19%、evasion +2.79%、capture +2.81%、terminal-resistance-gote +0.45%。recaptureは2022.945→1944.561msへ3.87%短縮、mixed-distanceは158.031→143.007msへ9.51%短縮。全体p50のみで改善を断定しない。
- 通常/qの本測定3回合計はfixed A=92,934/34,686、B=C=92,766/28,275。反復合計はA=116,496/32,685、B=C=116,178/27,096。今回の変更は再利用件数や省略ノードを増やしていない。
- 100msの基本12局面深さ分布B→Cはd0:6→6、d1:6→4、d2:15→16、d3:9→10。両方completed30/partial6/fallback0。最大超過 **2.689→2.778ms**（+0.089ms）。1,000msは両方d2:7/d3:8/d4:21、completed36、最大超過 **1.791→1.391ms**。100ms p50/p95=100.453/102.644→100.655/102.465ms、1,000ms=605.685/1001.480→609.034/1001.128ms。個別悪化も保存し、一般の安定性改善と断定しない。
- 全追加条件込みのC本測定はlookup261,447、miss223,972、粗hit37,475、生成145,404、一致/再利用37,190、不一致285、非exact拒否115,953、サイズ拒否303、store107,911、eviction65,160。最大保持 **512件 / 2,357,618文字**。B/Cの決定的容量観測は一致。RSSは共有processで呼出し前後を観測した最大値であり、単独variantのメモリ占有差を証明しない。
- 追加3局面d5はすべて完了し、B/C全結果/旧統計一致。120手の完全な合法履歴を持つ局面もd4/反復/100/1000ms/d5を実施した。事前probeはcoldの費用確認であり、主測定の速度比較へ合算しない。

### 工程別診断と限界

通常測定の製品経路へ時計を追加しない。`diagnostic/` はprototype wrapperと工程別時計を入れた別実行であり、通常の速度比較に使用しない。

| 工程 | 観測範囲 |
| --- | --- |
| A 粗いキー生成 | key全体の時間。positionKey/JSONを含む |
| B 詳細identity生成 | Cの候補hit時だけ `hitIdentityMs`。miss→exact保存用とBの事前生成は含まない。全体生成時間の推定に使わない |
| C 詳細比較 | probe全体の時間。Map検索・統計更新・Cのhit時identity生成を含む。純粋な文字列比較時間ではない |
| D 保存result複製 | private cloneを直接計時しない。残余時間から推定もしない |
| E 保存容量判定 | store全体の時間。result JSON、容量判定、Map操作を含む。複製は含まない |
| F 省略探索 | 上記A/B/Cの通常/qノード差、exact再利用件数。省略した探索の時間を直接測った値ではない |

細分化の呼出し/時計費用は診断実行の実時間に含まれる。主測定とのJIT状態も異なるため、両者の差をinstrumentation overheadの純粋な推定値としない。工程Dと全identity生成時間の独立定量は未実施であり、既知の制約として残す。

## 採用判断

**B：安全性維持、改善は限定的。既定OFF継続。** 正当性の不一致は未検出、詳細生成のほぼ半減を確認した。一方、観測された合計時間0.99%短縮はn=3・OS/JIT/GC/電力/affinity未固定の揺れに対して小さく、fixedでは悪化している。速度改善を確証したとはしない。deadline超過の最大や完了深さも混在するため、一般棋力や安定性の向上を主張しない。局面別RSS上限・全局面の正当性の数学的証明は行っていない。

次の課題は、JIT状態/実行環境を揃えた多回測定と固定d4の悪化確認、粗いキー/履歴走査/identity/clone/容量判定の費用を低擾乱でさらに分離すること。Zobrist、容量拡大、bound再利用、ply変換、永続/Worker共有、既定ON、UI/評価変更は今回実施せず別PRの候補とする。

## 再現と原本保全

Node 24/npm 11、同じlockfileで `npm ci`。基準mainを別checkoutへ用意し、以下のBASELINEに指定する。既存の出力フォルダーは上書きしない。基本12局面の完全入力、120手履歴、ソースgzip/hash、Node/npm/OS/CPU、warmup・実行順はplanへ保存。測定時ソース原本のbyte hashは改行を含む。別cloneの現行ソース照合とmanifestのテキストhashはUTF-8のCRLFをLFへ正規化するため、通常のLF/CRLF checkoutの双方に対応する。gzip等のbinary hashは正規化しない。

```powershell
node --import tsx scripts/audit-tt-two-stage.ts reference NEW_REFERENCE.json.gz BASELINE
node --import tsx scripts/measure-tt-two-stage.ts probe NEW_PROBE BASELINE
node --import tsx scripts/measure-tt-two-stage.ts run NEW_RUN BASELINE
node --import tsx scripts/audit-tt-two-stage.ts summary NEW_RUN
node --import tsx scripts/measure-tt-two-stage.ts diagnostic NEW_DIAGNOSTIC BASELINE
node --import tsx scripts/audit-tt-two-stage.ts summary NEW_DIAGNOSTIC
npm run check
node docs/benchmarks/tt-two-stage-20261021/report.mjs
node docs/benchmarks/tt-two-stage-20261021/compress-raw.mjs
node --import tsx scripts/audit-tt-two-stage.ts summary docs/benchmarks/tt-two-stage-20261021/run1
node --import tsx scripts/audit-tt-two-stage.ts manifest docs/benchmarks/tt-two-stage-20261021
git diff --check
```

`report.mjs` は同梱run1のrawからreport/resultsを再生成し、既存出力があれば完全一致を要求する。auditはrawの件数/欠測/重複、raw/hash、ソースgzip/hash、結果/PV/統計/容量、PR #196原本のdiff=0を検証し、既存summaryの完全一致を要求する。manifestは本診断と主要ソースのhashをrepo相対キーで保持する（テキストはLF正規化、gzipはbyte hash）。rawは非有限値を`+Infinity`/`-Infinity`として保持し、gzipは元bytesへ復元できる。stdout/stderr原本は改行を含むbytesを維持してvalidationのgzipへ保存する。CRLFの原本をそのままテキスト追加するとdiff --checkが末尾CRを指摘するため、原本を変更せず可逆圧縮する。
