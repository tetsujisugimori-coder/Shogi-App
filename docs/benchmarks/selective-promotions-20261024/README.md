# 選択的非捕獲成りq探索（2026-10-24）

基準main `0dd33ebe9791b2e14abdbbf6ae549c1257d97041`。PR #210は2026-10-24にマージ済み。開始clean、fetchでorigin/mainと一致、専用ブランチ `codex/selective-quiet-promotions`。親・リポジトリ内のAGENTS.mdは見つからず、チャット指示の「末尾に日時」を適用。README/LOG、#202/#204/#206/#208/#210とIssue #209を確認した。GitHub connectorは「not available」を返したためghへ切替。既存原本には書込みなし。

## APIと近似

A: `quiescence: {maxTacticalDepth:1}`（従来OFF）。B: `{maxTacticalDepth:1, includeQuietPromotions:true}`（PR #210と同じ全合法非捕獲成り）。C: `{maxTacticalDepth:1, selectiveQuietPromotions:{maxCandidates:1}}`（新しい明示opt-in）。正整数の上限を必ず指定する。BとCの同時指定はRangeError。Worker/UI/保存形式、評価設定、既定OFFは維持。

既存の合法手一覧から非捕獲成りを抽出する。駒価値は呼出し元のmaterial tableを使う。成った盤面の2升だけを差し替えた一時的な読み取り用盤面で既存isPieceAttackingを呼び、成り先への敵の最安攻撃駒と味方の取り返しの利きを調べる。合法手再生成、executeLegalAction、SEE、深い探索、評価関数の追加呼出しはしない。元盤面は変更しない。

- gain = 成駒の盤上価値 − 元駒の盤上価値。
- loss = 成駒の盤上価値 ＋ 元駒の不成持駒価値。
- 敵の利きなしならrisk=0。ありならrisk=max(0, loss − 味方の利きがある場合の最安敵攻撃駒の盤上＋持駒価値)。味方の利きがなければrisk=loss。
- score=gain−risk。score>0、または成駒からの直接王手を候補に残す。score降順、同点は直接王手、さらに同点は元合法手index。先頭から指定上限まで選択する。探索順は残った候補の元合法手順を維持し、既存material orderingも使える。

閾値0は概算の純駒得が正となる境界で、任意の駒種ボーナスやチューニング係数は導入しない。正負だけが有益性を保証するわけではない。全候補を探索しない近似であり、最善手の完全性を保証しない。ピンされた駒や玉も生の利きとして数え、合法な取り返し、連続交換、強制応手、移動による開き王手（直接王手以外）、位置評価、成らない手の価値は選別スコアで完全には扱わない。チェック成りも上限から漏れ得る。

駒種優先だけ、非捕獲手にnullを返す既存SEEの流用、候補毎の合法手再生成は不採用。初案の「王手をスコアより常に優先」は危険な飛車王手成りが安全な成りを押し出しPR #208の既知局面で2回帰を生んだため不採用。失敗ログfocused-tests.logを保持し、スコア主順位へ修正後44/44成功。上限1は既知の先後回避局面・安全/危険成り回帰を保つ最小値として時間測定前に固定し、1/2/4の予備比較は探索的資料に限定する。検証結果を見て上限・閾値を再調整していない。

## 契約

通常捕獲を選別で除去せず、成り捕獲を重複追加しない。王手中は全合法応手、q深さ/王手回避予算、stand-pat、窓、終局カテゴリ・距離、PV/内訳、期限例外、partial-root/fallback、完了統計の経路をそのまま使う。selector設定はResolvedQuiescenceOptions経由で既存TT詳細identityへ含まれ、呼出し中は複製した設定を使う。TTは従来同様1公開呼出し内のみ。王手回避拡張時のTT迂回も維持。

SearchDiagnosticsに任意のq-select-promotions工程と非王手局面の対象/追加候補数を追加。追加数は候補集合へ入れた数であり、stand-patや窓の枝刈り前。ノード数は既存定義の完了反復分、診断は中断作業も含むが選別途中で止まった現ノードの候補数は未計上。測定本体は診断OFF、選別費用・対象/追加数は別の診断ONプローブから報告する。時限では探索量が異なるので本体とプローブを同一サンプルとして合算しない。

## 測定と再現

測定前の全入力・完全履歴・条件はrun2/plan.json、実行ソースgzip、基準src archiveを保存した。warmupは本測定から分離。A/B/Cは同一評価standard、通常standard、q1/original/extra0、killer/PV/TT=false、既存代表10局面、固定d1/d4、100/1000ms・最大通常d4。固定warmup1/本1、時限warmup1/本3。予備はC1/C2/C4・d1/100ms、warmup1/本1。逆順と巡回で実行順を交替、同期直列。test/buildとの並行なし。

既存#204の16局面をd3・6000nodeの正逆全幅参照で分類し、#206の限定AND/OR証明と別再生検証も先後evasion両候補に試みる。有限QualityGapを勝敗改善へ読み替えない。対局は既存pairedSelfPlayMatchを再利用し、毎手の入力Proxy保護・PV/内訳・合法手・終局判定を検査、全棋譜を再生する。100msは平手、合法平手再生、構成evasionの3ペア各120plyまで。1000msは平手/evasionの2ペア各80plyまで。A参加者=OFF、B参加者=選択C1。同じ開始状態/時間/評価/規則で先後入替。規則引分、max_plies打切り、failed、未完了は分離する。

親processの900秒全体上限（起動を含む）、通常task30秒、対局pair200秒watchdog。40MiBにはplan/source/rawと生成report/manifestを含め、停止記録用256KiBを予約。書込み前byte検査、raw新規作成のみ、全taskの開始/終了・失敗・stderrを保存、停止時は子を終了し後続探索をしない。通常auditは不完全runを拒否する。同期合法手生成などの強制中断不能区間は残る。OS回収/I/Oの厳密期限は保証しない。検証ログは測定rawの予算外。

run1は準備のみで探索0。準備用Pythonの既定cp932によるrunner読取りエラーのあと、監査と型exportのsnapshotを補強しrun2を新規準備した。run1原本も残し、測定成功に含めない。最初のテストはsandbox TEMPでtsx cache rename EPERMのため実行0。TEMP/TMP/TMPDIRをworkspace内node_modules/.cache/selective-tmpに設定すると起動し、assertion失敗とは区別できた。

```powershell
# 基準srcを .diagnostic-temp/selective-baseline に git archive/tar で隔離展開してから実施
$env:TMPDIR="$PWD/node_modules/.cache/selective-tmp"
$env:TEMP=$env:TMPDIR; $env:TMP=$env:TMPDIR
node --import tsx scripts/measure-selective-promotions.ts prepare NEW_DIR
node --import tsx scripts/measure-selective-promotions.ts run NEW_DIR
node --import tsx scripts/measure-selective-promotions.ts audit NEW_DIR
```

prepare/runは既存のplan/rawを上書きしない。auditはmanifestが既にあれば検証し、保存rawからsummary/results/manifestを再生成する。後からソースが変わった場合、実行はplanのhash照合で拒否する。再現実行には保存gzipの測定時ソースを別checkoutへ復元し、監査には現行互換ルールを用いる。

## 結果と採用判断

本測定は2026-10-24 22:13:38 JST開始、Windows 10.0.26300 / i7-14650HX / Node24.20.0。設定/時刻/dirty情報/ソースbytesはplanとrawのenvironmentへ保存。20互換＋予備120＋性能360（warmup120/本240）＋別診断90＋局所36＋品質16＋証明4＋対局5ペア、計651記録。性能比較中の例外・欠測・watchdog停止0。10局456plyを保存・合法再生。測定ディレクトリ約11.24MB/40MiB。派生表は[run2/results.md](run2/results.md)、全選択手・評価・PV・内訳・最終/完了合計ノードは[raw.jsonl](run2/raw.jsonl)、局面別反復値は[analysis.json](analysis.json)。

| 本測定 | A OFF | B 全候補 | C 上限1 |
|---|---:|---:|---:|
| 固定d1・10局面 qノード |27|94|56|
| 固定d1 API合計ms |52.132|64.240|57.639|
| 固定d4 通常/qノード |41065/30033|42440/45138|41366/33328|
| 固定d4 API合計ms |29895.426|33153.460|32373.662|
| 100ms・各30本 完了深さ合計 |67|56|59|
| 100ms A比改善/悪化/同じ |—|1/12/17|0/8/22|
| 100ms 最大超過ms |2.457|1.437|2.192|
| 1000ms・各30本 完了深さ合計 |105|97|98|
| 1000ms A比改善/悪化/同じ |—|0/8/22|0/7/23|
| 1000ms API合計ms |21458.300|23201.342|22287.380|
| 1000ms 最大超過ms |3.418|1.369|1.837|

CはB比で固定d1 q −40.43%、d4 q −26.16%、d4 API −2.35%。一方A比でd4 API +8.29%、q +10.97%。短時間の深さ悪化を緩和するが解消しない。1000msにもA比7対の深さ悪化があり、長時間なら有効という次善策も確認できない。各時限90本は全てcompleted-iteration、partial/fallback0（制御時計回帰と対局の実例は別）。ノード数だけを性能改善と判定しない。

別診断の固定d1は対象124候補、B追加124、C追加41、C選別計2.348ms/診断ON API計116.678ms。q実行ノード数とはstand-pat/窓によって一致しない。100ms各10本のCは対象884/追加273、選別27.835ms（API1007.457msの2.76%）。1000msは8477/3096、237.650ms（API8335.750msの2.85%）。選別費用は小さくない。診断ONは合法手生成内の時計等も有効で、通常OFF本体との時間や完了深さは同一条件の値ではない。固定d1の診断ON/OFFは時間を除く全結果一致を別監査した。

予備C1/C2/C4のd1 qは56/75/91、API合計44.131/46.259/48.967ms。100ms深さ合計は23/24/24、改善の主張に使える反復数ではなく、上限1が普遍最適とも言えない。これを見て本条件を変更していない。

品質16局面はAがProvenError0 / QualityGap1 / Inconclusive7 / NoObservedDifference8、B/Cとも0/0/7/9。既知evasionの有限d3参照との差をB/Cが解消。残りの完走8局面で新たな分類悪化なし。局所先後回避や成り後取り返し・大駒交換もrawへ保存。参照上限7局面を成功に含めず、先後evasionのA/C計4候補のAND/ORはdepth/timeで全てunknown、検証対象の勝敗証明書0。**勝敗改善やProvenErrorの解消を発見したとは報告しない。** 同じ評価・ルールを共有し、人工局面と有限horizonに依存する。

|先後交代対局（C視点）|勝|負|規則引分|手数上限打切り|失敗/未完了|
|---|---:|---:|---:|---:|---:|
|100ms 3ペア6局|2|1|2（千日手）|1（120ply）|0/0|
|1000ms 2ペア4局|2|2|0|0|0/0|

100msの平手は千日手1/打切り1、合法平手再生はC勝1/千日手1、構成evasionは双方1勝。1000msは平手もevasionも双方1勝で、先後差が大きい。勝ち理由はcheckmate/no_legal_actionsで既存規則のまま。少数局・限定開始局面・実時間による非決定性・反復数不足があり、勝率の信頼区間や一般棋力を結論しない。B対局、長い実戦局、別PC、SEE通常順序の時限比較は未検証。

**採用判断：第一希望・次善策とも未達。実用推奨は不採用、研究用の明示opt-inだけを保持する。既定OFF継続。** 既知の成りを含む浅い戦術差を維持しつつBの候補負荷は減るが、Aより探索が浅くなり、一般棋力向上の十分な証拠はない。長時間向けとしても推奨しない。重要な成りを除外する可能性とraw/診断で追試できる設定を残すための妥協であり、棋力改善達成とはしない。

将来は独立した開始局面群を事前固定した多数ペア、より大きい参照予算と独立エンジン、非王手stand-patで切れる前の選別コスト削減、ピン/連続交換の安価な近似、直接王手と安全成りへの別上限を一つずつ評価する。今回結果に合わせた閾値や局面別分岐の追加はしない。

再集計は2回ともsummary SHA256 `83537b299e7f20958bb7afa7aaca2a5808597e5a1dad9be51eac0d1bfd714e16` 一致。追加監査は全task開始/完了・全cell・固定診断互換・品質再分類・全10局456plyのPV/棋譜/終局/最終状態・manifest/容量を再検証した。最初の追加監査はJSONで省略されたundefined optional属性を再生のメモリ状態とdeepEqualしたため失敗（replay-audit.log保持）。JSON正規化後に全値を比較し成功した。測定rawや結果値は変更していない。analysis.jsonも次のCLIで再生成できる。

```powershell
node --import tsx scripts/audit-selective-promotions.ts docs/benchmarks/selective-promotions-20261024/run2
node scripts/report-selective-promotions.cjs docs/benchmarks/selective-promotions-20261024 NEW_ANALYSIS.json
```

partial-rootのexactは選択した近似探索木に対する窓条件であり、省略した成りを含めた完全な最善手や勝敗の証明ではない。

## 検証・自己レビュー

- 新規25＋補強4＝29件成功。先後、飛角/小駒、安全/被捕獲/味方の取り返し、移動元の開き利き、直接王手成り詰みとmate-distance、強制成り/不成、捕獲重複防止、全王手応手、安定した選別、custom material、q0/上限/stand-pat窓、中断、partial-root/fallback/最後の完了反復、合法PV/評価内訳、Proxy入力保護、TTの実際のstore identityとPVヒントを検査。
- 現在の関連13ファイル388件成功（related-current-tests.log）。最初の関連コマンドはfile filterが既存.worktreesにも一致し48ファイル1714件成功したが、現在の関連結果は--dir src/testで別に確認した。既存worktreeには変更なし。基準src archiveの自作一時展開のtestディレクトリだけはnode_modules/.cacheへ移し、全体収集から除外した。原archiveは保持。
- 現在の全体 `npx vitest run --dir src/test` は88ファイル2274件中2273成功、既存 `quiescence-ordering-repeated` のsnapshot mock 1件が5秒上限でtimeout（実7.208秒）、full-current-tests.log保持。単独37件は全成功（テスト計1.51秒）。先行PRにも同型timeoutがあるが、今回の原因同一性は断定しない。**全体成功とは報告しない。** timeout/assertion/期待値/worker数は不変。一般のnpm testは既存.worktreesも収集するため現在の全体範囲を明示した。
- lockfile / TypeScript・lint / production build成功（1762 modules、build 27.20秒）、git diff --check成功。新たなスキップなし。CIはpush後の最終HEADで別に確認しPR本文・最終報告へ記載する。
- 追加再生監査の成功は[validation/replay-audit-v2.json](validation/replay-audit-v2.json)。派生analysisの再生成もbyte一致。JSONのundefined属性省略以外の値は比較から除外していない。原本raw/summary/manifestは変更なし。
- 停止smokeは本測定と分離した新規planで介入内容を明記。budget-zeroは全体0ms、開始0/完了0、failure=global time budget。budget-smallはjournalへ10KiBを割当て開始26/完了25でfailure=storage budget、1,658,631/1,921,191 bytes、以後探索なし・ended=false・非zero終了。rawと終了ログを保持し成功測定へ混ぜない。
- 自己レビューではOFF/B候補集合、王手経路、selectorの選択範囲、material table、移動元の開き利き、合法手再生成なし、scoreとcapの限界、停止例外伝播、TT識別に設定全体が入ること、PV/partial exactの意味、基準ソース互換、全予定cell、証明unknownと有限参照の分離、raw保存/容量/実験順序を確認した。自己レビューは第三者レビューではない。

固定d4の各cellはwarmup後1本、時限は3本でOS/JIT/GCの揺れが残る。上記百分率は今回の合計実測で、安定した一般性能差や勝率の推定値ではない。計測器OFF本体とON別プローブを混ぜず、ノード数には中断した探索の全作業を含まない点に注意する。参照不完走7局面、限られた局数、直接王手以外の戦術、ピン/合法取り返しの近似の限界は未解決のまま独立レビュー待ちとする。
