# 駒安全度の限定実験

基準mainは `e2f12e97f2d2c297b3b2ac5648bbfb12dc53faad`。PR #212のMERGEDとfetch後HEADを確認し、既存作業環境を読み取り専用にして別clone・専用 `codex/piece-safety-experiment` で実施した。Issue #209の交換判断調査に対し、#210/#212の非捕獲成り・q候補選択とは別に、既存静的安全度だけを限定変更する。SEE/qの意味・既定値は変更しない。Issue本文は変更しない。

## 実装と限界

`SearchEvaluationOptions.pieceSafetyMode` に `legacy | experimental` を追加。未指定はlegacy。既存MaterialValueTable引数と評価プリセットを維持する。

```ts
analyzeAlphaBetaSearch(state, 3, { pieceSafetyMode: 'experimental' });
analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(
  state, 4, 100, { pieceSafetyMode: 'experimental' }, undefined,
  { quiescence: { maxTacticalDepth: 1 } }
);
```

非玉の盤上価値をV、生の敵攻撃数A、味方守備数Dとする。legacyはA>0かつD=0だけ `0.1V`。experimentalはA>0で `0.1V × A/(A+D)`、A=0は0。両者とも相手側ペナルティ−視点側ペナルティを返す。無防備な駒は同一の算術、攻撃された守備付き駒には最大10%の小さな警告を残す。成駒は盤上価値、持ち駒はこの項目に含めない。玉自身はkingSafetyで扱う。駒損そのものをmaterialへ加算しない。係数は測定前に固定し、測定を見て調整していない。

**これは交換損の計算ではない。** 敵の生の利きと合法捕獲、味方守備と合法取り返し、攻撃数差と実際の駒損を同一視しない。駒価値の異なる攻撃・守備、ピン、開き王手、連続交換はこの式では解決しない。共有AttackCountMapsと既存の盤面走査を再利用し、静的評価で合法手生成やSEEを呼ばない安全な範囲へ限定した。

変更前の `before/` は全局面入力・履歴・持ち駒・対象駒価値/利き数・4項目・合法手・d1/d3・捕獲ごとのSEEを保存。`exchange-chain` は旧安全度0でも飛車の歩取りSEE−1000、金の歩取り0。`pinned-defender` の金は見かけ上の守りだが横へ動くと自玉に王手となる。有限d3も限定SEEも全局面の勝敗証明ではない。初回SEE-deadlineの空履歴は旧入力のままbeforeとrun1に保存し、run2のadapterで既存APIにより初期履歴を正規化した。

実験モードはαβ・反復深化・時限探索・qが使う既存評価経路へ接続する。既存の4項目名、total、selectedEvaluation、root視点PV、終局カテゴリ/距離、部分探索・fallback・中断、合法手・手順序は維持。Worker/UI/保存形式を変更しない。TTは呼出し内専用で、legacyの詳細identity bytesを維持し実験版だけ識別子を追加する。不正モードはfallbackより前に拒否し、実験項目の異常な駒価値/非有限ペナルティも拒否する。

## 測定と監査

[事前計画とrun2前の修正](plan.md)、[保存原本の再集計結果](results.md)。主性能は診断OFF、診断ONは別probe。追加の `cost.json` は同一28入力・同じ共有マップで各1000回、warmup1＋本3、AB/BAの静的評価費用。これを探索時間や棋力の改善と読み替えない。

全28局面は既存の10交換局面、既存10戦術局面、追加4条件の先後8局面。人工局面は平手からの到達可能性を主張しない。`tactical-hirate-exchange` は6手の合法平手棋譜由来で完全履歴を保存する。全局面を測定前に既存validatePositionで検査する。

各条件warmup1＋本3、AB/BA、d1/d3・100/1000ms(max d4)、standard評価、通常standard/q1 original、静かな成りOFF、TT/PV/killer OFF。勝敗証明と有限参照を分け、既存ProvenError/QualityGap/Inconclusive/NoObservedDifferenceの意味を変更しない。参照は旧評価によるd3全幅/正逆、6000node上限。値の改善と参照上の選択手改善は別。参照のルールと評価を共有する制約がある。

対局は既存paired self-play、100msで平手/合法棋譜由来/王手回避の3ペア、1000msで平手/合法棋譜由来の2ペア、120ply上限。同一開始局面で先後交替。全棋譜・各手のPV/内訳/結果source・最終局面・終局理由をrawへ保存し、全合法再生と葉の評価内訳を監査する。手数打切りと規則引分を区別する。小標本なので一般棋力を断定しない。

各runは親側15分/64MiB上限、個別30秒（対局260秒）。失敗/親停止/欠測はraw・summaryへ残す。test/buildは測定と直列。監査はsource gzipと基準archive、入力/plan hash、task coverage、全PV/棋譜/内訳/終局を検査し、既存manifest照合後に保存rawから再集計する。2回のsummary/report hash一致を記録する。旧測定ディレクトリを編集しない。

## 再実行

```sh
npm ci
mkdir -p .diagnostic-temp/piece-safety-baseline
git archive e2f12e97f2d2c297b3b2ac5648bbfb12dc53faad src | tar -x -C .diagnostic-temp/piece-safety-baseline
node --import tsx scripts/measure-piece-safety.ts prepare NEW_DIRECTORY
node --import tsx scripts/measure-piece-safety.ts run NEW_DIRECTORY
node --import tsx scripts/measure-piece-safety.ts audit NEW_DIRECTORY
node --import tsx scripts/measure-piece-safety.ts audit NEW_DIRECTORY
node --import tsx scripts/report-piece-safety.ts NEW_DIRECTORY
node --import tsx scripts/report-piece-safety.ts NEW_DIRECTORY
node --import tsx scripts/measure-piece-safety-cost.ts NEW_DIRECTORY/plan.json NEW_COST.json
```

各出力先は新規にする。WindowsではNew-Itemでディレクトリを作成し、git archiveの `-o TEMP.tar` と `tar -xf TEMP.tar -C ...` を使える。既存原本を上書きするrunは禁止。監査の派生summary/manifestだけは再生成する。最終HEADとCI対象SHA/結果はDraft PR本文に記録する。

## 失敗・検証・採否

初回npm ciと権限付き再試行は証明書検証エラー。TLS検証を無効にせず、同じlockfile hashの既存mainのnode_modulesをコピーした。初回sandbox testはesbuildの親ディレクトリ権限不足で起動失敗。基準全体テストは2397成功/既存UI timeout1件で失敗し、全体成功とは扱わない。初回新規テストの型検査は存在しない公開terminalDistancePly参照を検出し、合法PVの終局距離検査へ修正した。ログはvalidationへ保存。

run1は682/698タスクまででSEE-deadlineの初期履歴不整合により参照段階で失敗、16欠測・対局未開始。前処理で全fixtureの整合性を確認してから、coverageを28局面に拡張したrun2を新規実行した。run1の部分結果をrun2成功へ混ぜない。run1の記録外側shellは当時EXIT=0だったがrawの子exit=1/ended=falseが真の状態で、現在のCLIは未完了を非zero終了にしている。

**総合判定：実用は不採用。再現・反証用の研究opt-inとしてコードを保持し、既定legacyを維持する。** 同じ思考時間での改善を確認できず、固定d3に負荷増がある。削除すると今回の比較を製品API経由で再現できなくなるため、少量の限定コードと回帰を保存する。通常利用への推奨はしない。

- 本測定：1012/1013タスク取得。性能matrixはwarmup224＋本672、診断56、互換28、有限参照28を完了。最後の1000ms/合法棋譜由来ペアは全体15分でSIGKILL、1タスク欠測。全体未完了であり成功扱いしない。raw約16.5MB（plan/source等を含む親記録）。容量上限には未到達。
- 固定d1は810.421→778.463ms（84本合計）。poisoned-rookの1局面3反復だけ有限d3参照の候補値589→640という改善を観測したが、どちらもQualityGapであり分類件数15は不変。固定d3の選択は全84対で同じ、42,843.304→47,640.232ms（+11.20%）。通常node 74,850→81,933、q 9,666→8,811で探索集合も変わる。
- 100msの完了深さは改善1/悪化1、1000msは改善4/悪化2。いずれも共通有限参照で改善0/悪化0/同値45/不足39対。100msで6対、1000msで1対の選択手差があるが、時限品質の改善には結び付いていない。ProvenErrorは全条件0。参照d3は時限探索のd4より浅い場合があり、39/84対が参照不足という制約がある。
- 深さが悪化した観測はtactical-mate-sente/100ms/run3、one-two-goteとpinned-defender/1000ms/run1。各−1ply。参照上の指し手悪化を証明したものではない。評価変更による枝刈り・探索集合の差、OS/JIT変動を分離し切れておらず、個々の時間差の原因を断定しない。有限参照での候補悪化例は今回は0件（改善だけを抽出した結果ではない）。raw/summaryに全対を保存する。
- 単独同一入力の本84,000回/方式では、4項目全評価863.720→862.697ms（−0.12%）、共有マップを渡す安全度単独33.093→34.173ms（+3.27%）。探索固定d3の+11.20%と同一視しない。主性能は診断OFF、診断ONの評価呼出し679→674回/評価時間65.513→64.153msは別probe。
- 100ms：B 1勝1敗、千日手1、120ply打切り3。勝敗2局は人工王手回避局面で両方後手勝ち。1000ms：保存済み1ペアは両局120ply打切り、予定2ペア目は未完了/未保存2局分。保存済み8局686plyを全合法再生・PV/内訳・終局監査済み。ペアが返るまで原本へ出力しない現ハーネスの制約で、親停止ペアの部分棋譜は保存できていない。これは残課題で、勝敗/棋力の証拠にしない。予定2ペア達成とは記載しない。
- run2のraw再集計2回のsummary SHA256は `68853f589d6e682cb4f2c0a459279f0843eda02579e07467fcf8343de1ac6a7d` で一致。run1の部分再集計2回も `7b8466a144f0b2108fc0da076e7e273f5faf66e56f6b74a7b1d7b546dc598a56` で一致。0ms上限では0/1013、容量縮小では2/1013取得後に停止し、各2回auditと全出力容量上限を確認した。失敗・欠測を成功へ混ぜない。
- 最初の保存棋譜監査は再生後に追加されるoptional undefinedとJSON上の省略が異なり失敗した。原本を保持し、最終局面だけを保存と同じJSON表現へ正規化して比較する修正後に2回成功。盤面・持ち駒・履歴・終局等の保存データはすべて比較対象。測定時ハーネスgzipを不変で保持し、最終sealはこの監査1行以外に差がないこと、製品3ファイル・fixture・テストの測定bytesが現在と一致することを検査する。初回レポートの型エラーもログを保持して修正した。

残課題：親停止時も各plyを逐次保存する対局journal、1000msの2ペア以上の完走、長期・大標本の独立対局、参照不足局面のより深い独立参照、攻撃/守備駒価値・ピン・合法取り返し・連続交換の限定評価。生の利き比だけでこれらが解決したとは主張しない。最終テスト/build/hash検証はvalidationとPR本文へ記録する。

## 最終検証

- 新規回帰35件成功（先後/符号、promoted/hand、pin、非破壊、有限性/不正モード、既定互換、4項目合計、固定/反復/100/1000ms、partial/completed/fallback/例外、PV、終局距離、TT識別、fixture事前整合）。先行関連4ファイル48件成功。その後の全体は**90ファイル2433件すべて成功**。基準実行の既存UI timeout1件という失敗記録は別に保持する。既存assertion/timeout/worker設定は変更しない。全体ログのjsdom navigation警告も原文のまま保存。
- verify:lock成功、最終lint（tsc --noEmit）成功、production build成功（1762 modules）、diff-check成功。途中のレポート型エラーは修正前ログを保持して最終lint成功と区別する。
- report.jsonの2回再生成SHA256 `f8895052ef64ffd79b86ad2c1404ba242c4d6eed3ba4faf63566cd276ddb198f` が一致。report-final1/2ログも同一。run1/run2/停止検証のrawとsource gzip、各manifestを保持する。evidence-manifest.jsonは今回の全証拠/ソース/README/LOGのhash、protected-originals.jsonは既存975原本のhashを保存し、seal verifyで照合する。測定時と最終製品ソースは同一、ハーネスは前述の監査1行だけを許容して比較する。
- `node scripts/check-piece-safety-budgets.cjs` は既存出力先があると拒否する。再試験時は別workspace/新規出力先を使用する。0ms・縮小容量の失敗/欠測/終了コードと2回再集計を確認済み。
- 全体実験は未完了である。ローカルテスト/build成功や原本監査成功を、未完了対局の成功や一般棋力向上へ読み替えない。GitHub CIは最終HEADを対象に別途PR本文で報告する。
- `.gitattributes` で今回の証拠を `-text` にし、stdoutを含むraw bytesをGitの改行変換から保護する。evidence-manifestの証拠項目/旧原本はbyte単位、README/LOG/設定/コード15ファイルだけはGit textのLF正規化後SHA256とする。測定時gzipは元bytesを不変で保持し、現在のコード内容は改行差と既知の監査1行以外不変であることを検査する。別OSでの照合は `node scripts/seal-piece-safety.cjs verify-evidence`、元PCで旧975原本も照合する場合は `verify`。最終Git indexから展開したbytesでもverify-evidenceを実行する。
