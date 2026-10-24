# PR #212 P2修正（2026-10-25 JST）

レビュー対象 `1b45ad1cab7a493223495b911fab944985456a2f`。開始clean、既存 `codex/selective-quiet-promotions` でfetchし、PR OPEN・remote/local/指定HEAD一致を確認。AGENTS.mdは親/リポジトリ内に見つからず、チャット指示の末尾日時を適用。README/LOGと対象3実装、既存テスト/ベンチを確認した。GitHub inline comments APIは0件で、今回の依頼本文をP2指摘の基準にする。新規PR・merge・auto-mergeは行わない。

旧 `selective-promotions-20261024` 以下の全追跡ファイルは測定前hash一覧として新runのplanへ保存し、監査で全件一致を要求する。旧raw/summary/検証ログ/manifest/READMEを変更しない。旧「Cの固定d4実時間はOFF比8.29%増」、研究用opt-in・既定OFF・一般棋力向上未実証という判断は保持する。

## P2-1：第一希望を見送り、次善策の部分削減

現行順序は静的評価→王手確認→合法手生成→選別→候補0件の戻り→stand-pat窓→子探索。候補が0件ならcutoffCount/skippedActionCountは増えず、候補があって窓が閉じたらcutoffCount+1、skippedActionCountへ実際の選別後候補数を足す。診断consideredは非王手での全合法非捕獲成り、addedは候補集合へ入った数（窓判定前）、工程費用は実処理の時計で測る。

候補数はcapに届くとは限らない。全てunsafeで0件の場合もあり、直接王手例外もある。score/risk/checkを求めず候補0/正件数を一般に判定できない。したがってstand-patを先にして選別を省くと、既存のcutoffCount、skippedActionCount、considered/added、候補なしstop reasonを変えてしまう。潜在候補数やcapでカウンターを埋めるのは契約変更/帳尻合わせなので行わない。

**第一希望の「stand-pat即時cutoff時に選別を全省略」は、指定された結果・統計契約と両立できず見送る。次善策として、敵玉の位置走査を最初の合法非捕獲成りを評価する時まで遅らせる。** 成り候補0件ならfindKingSquareを0回にし、複数候補でも従来どおり1回（玉なしのnullも再利用）。全合法手loopと既存の中断確認回数/位置、候補順位/選別基準/閾値/cap/探索順、窓判定順は維持する。quiescenceSearchにはこの依存関係をコメントで明記する。

これは玉位置の盤面走査1回の限定的な削減であり、成り候補のあるstand-pat cutoffでの駒価値・利き・取り返し概算・sortは残る。候補0件でも中断確認loopは残す。高速化や棋力改善を先に主張せず、修正前後の実測で確認する。選別を全面省略するには統計契約の変更、または同じ候補件数を正確に求める別処理が必要になる。例えば件数専用の早期停止やsortだけの省略も考えられるが、中断確認・非有限値例外・選別集合との整合を別途検証する必要がある。今回は処理順を変えない最小の次善策に限定した。

## P2-2：検証と正規化を一つにする

`resolveQuietPromotionSelection`が入力を一度読み、正規化済みの新しい `{maxCandidates}` を返す。αβ公開入口とstandalone q入口で同じ関数を使い、検証後のspread複製を廃止した。既存validate関数もこのresolverへ委譲する。

- selectorのundefinedは省略（OFFまたは別のincludeQuietPromotions設定）として扱う。
- maxCandidatesは**ownプロパティ必須**。通常の列挙可能プロパティ、Object.definePropertyで作った列挙不可プロパティ、null prototypeのown値を許可する。
- 継承値だけのmaxCandidatesは入口でRangeError。継承プロパティを設定値として読まない。未知のown項目は非列挙・Symbolも含め拒否する。
- own maxCandidatesを1回だけ読み、正の安全な整数を検査。maxCandidates:undefined、0、負数、小数、NaN、±Infinity、安全整数超過を拒否。null/配列/非object/欠落/未知own項目を拒否。
- 正規化結果は列挙可能なplain data propertyを持ち、再検証・TT identityで同じ値を使う。getterの呼出しも1公開入力につき1回。検証成功後にspreadで値が消える余地をなくす。
- 従来OFF/全候補ON/選択方式の意味と相互排他を維持。全候補true＋selectorは拒否。Worker/UI/保存形式/評価/SEE/選別基準は変更しない。

旧実装は通常・列挙不可・継承値をvalidatorで全て許可するが、後二者はαβのspread後のq再検証でRangeErrorとなることを旧HEADの実モジュールで再現した。[config-reproduction.json](validation/config-reproduction.json)。修正後は通常/列挙不可が成功、継承値だけは契約どおり入口で拒否する。既存の正常なplain object呼出しを維持する。

## 回帰と修正前の証拠

レビュー対象のsrcをgit archiveで隔離展開し、旧qの96条件を実行してfixtureを生成した。構成局面6（非捕獲成り0/1/複数/危険で選別0/王手/捕獲）×先後2×max/min視点2×窓4（無限/stand-pat一致/1点開/既に閉）を固定。fixtureは旧HEAD SHA・旧3ソースhash、完全状態、結果/PV/内訳/q統計、診断considered/added/selection呼出し数、中断確認回数を含む。生成スクリプトはvalidation/prepare-fixture.ts.txtに保存し、`.diagnostic-temp/prepare-p212-fixture.ts` に置いて再生成できる。

新テストは全96条件の結果をそのまま比較し、入力非破壊、0候補と正候補の異なるcutoff統計、成り0件の玉位置走査0回・複数時1回、閉じた窓での中断1/2/5/10回目の伝播を確認。設定について通常/非列挙/null prototype、継承値拒否、getter1回、undefined、各不正値/余分な項目、相互排他、固定/反復/standalone q、実TT store identityを確認する。既存の成/不成/強制成り、王手全応手、捕獲、mate-distance、q予算、PV、TT/PVヒント、partial/fallback/完了反復テストも維持し、期待値/timeout/worker数は変更しない。

## 性能確認の固定条件

新 `scripts/measure-selective-review.ts prepare|run|audit NEW_DIR` を使い、旧run2/planの10局面と完全履歴を読み取り専用で再利用。A=OFF、B=全候補ON、C=上限1、standard評価/通常順序、q1/original/extra0、killer/PV/TT=falseを維持する。固定d1/d4各warmup1本1、100/1000ms通常最大d4各warmup1本3。各局面/反復でbefore/afterの順を交替しABCも逆転、同期直列・測定中test/buildなし。修正前はレビューHEADの実src、修正後は今回のソースを同じprocessで読み込む。

診断OFFの720呼出しと別診断ON180呼出しを分ける。選択手/評価/PV/通常・qノード/完了深さ/結果source/API実時間/超過/候補数/選別時間を保存する。固定前後120比較は全非時間結果一致を要求。診断固定d1もOFF本体と非時間全結果を比較する。時限は予算による深さ/PV変化を保存し、同一結果の保証としない。親の全体900秒/1task30秒・40MiB保存上限/終了予約256KiB、新規rawのみ、失敗・途中停止を記録して終了。不完全runは通常auditで拒否する。

prepareで条件と測定ソースgzip、旧src archive、旧証拠hashを固定。auditはそれらを検証し、保存rawの全900cell、合法選択/PV/末端内訳・固定結果一致・旧証拠不変を確認してsummary/resultsを再生成する。2回の再集計で一致を確認する。従来の8.29%は旧原本の基準情報として残し、今回のbefore/afterやA/B/Cに混ぜて再計算しない。

## 修正前後の実測結果

2026-10-25 00:04:10〜00:14:56 JST、Windows 10.0.26300 / i7-14650HX / Node24.20.0。900/900呼出し完了、例外・欠測・watchdog停止0、stderr空。診断OFF720（warmup240/本480）とON180を分離した。固定前後120組と診断固定d1は時間以外の全結果が一致し、固定d1/d4のqノードはA=27/30033、B=94/45138、C=56/33328で前後不変。新テストの96q条件でもPV・内訳・統計・中断確認回数を維持した。

全A/B/C表は[run1/results.md](run1/results.md)、選択手・評価・PV・完了/最終ノード・候補数・費用・超過・sourceは[raw.jsonl](run1/raw.jsonl)に保存。以下は各10局面の合計（時限は3反復で各30本、別診断は各10本）。

|指標|C 修正前|C 修正後|
|---|---:|---:|
|固定d1 API合計ms|57.937|57.319|
|固定d4 API合計ms|32456.414|32488.714|
|固定d4 通常/qノード|41366/33328|41366/33328|
|100ms API合計ms|3015.828|3014.004|
|100ms 完了深さ合計|61|60|
|100ms 最大超過ms|2.440|1.115|
|1000ms API合計ms|22157.408|22276.347|
|1000ms 完了深さ合計|104|105|
|1000ms 最大超過ms|1.554|1.122|
|別診断d1 対象/追加|124/41|124/41|
|別診断d1 選別ms|2.509|1.500|
|別診断100ms 対象/追加|959/297|1037/326|
|別診断100ms 選別ms|32.173|26.896|
|別診断1000ms 対象/追加|8604/3118|8662/3132|
|別診断1000ms 選別ms|242.449|218.931|

Cの固定d4 APIは約0.10%増で、全体高速化は確認できなかった。制御としてAのd4合計は30654.838→31154.484ms（約1.63%増）、Bは35050.137→34669.972ms（約1.08%減）と揺れた。固定はwarmup後1本、時限は3本という少数実測であり、OS/JIT/GCの変動が残る。Cの100ms深さは改善0/悪化1/同じ29対、1000msは改善1/悪化0/同じ29対。Cの選択手は前後全60対同じで、深さの変わった各1対でPVが変わった。Aは両予算で深さ・選択手・PVが全対同じ、Bも各1対で深さ/選択手/PVが変わり、時限での完全一致を主張しない。

診断固定d1は同じ結果/候補数で選別実時間が減ったが、診断ON API自体は116.556→118.555msで短縮していない。時限プローブは中断までに進む仕事量が異なり対象/追加数も変わるため、選別msの減少率を同量処理の一般的な速度向上にしない。診断OFFの主測定にON値を混ぜない。主測定の時限360本（before/after各180）は全てcompleted-iteration、partial/fallback0。中断分の全探索ノードは従来カウンターに含まれず、実時間には含まれる。

**判断：P2-1の第一希望は未達、次善策の不要な玉位置走査削減を採用。呼出し回数0/1と結果・統計の互換性は確認できたが、API実時間や完了深さの改善は未確認。P2-2の設定整合性は修正済み。** 研究用opt-in・既定OFFを維持し、棋力改善は主張しない。今回対局・新戦術・新選別基準・評価/SEE・自動cap調整は追加しない。旧8.29%の結果や旧対局を今回の改善証拠に読み替えない。

再集計は2回ともsummary SHA256 `6ea0f1ad8e746dee2cb8410a338aa7fd923ea1d244610441bd43f4c9eda7aabf` で一致。旧証拠90追跡ファイルはhash不変。plan/測定ソースgzip/旧src archive/測定raw/生成表/manifestを新ディレクトリへ保存し、旧ファイルの上書きなし。

```powershell
# 旧srcを .diagnostic-temp/p212-before へ隔離展開してから実施
# git archive --format=tar --output=.diagnostic-temp/p212-before.tar 1b45ad1cab7a493223495b911fab944985456a2f src
# tar -xf .diagnostic-temp/p212-before.tar -C .diagnostic-temp/p212-before
$env:TMPDIR="$PWD/node_modules/.cache/selective-tmp"
$env:TEMP=$env:TMPDIR; $env:TMP=$env:TMPDIR
node --import tsx scripts/measure-selective-review.ts prepare NEW_DIR
node --import tsx scripts/measure-selective-review.ts run NEW_DIR
node --import tsx scripts/measure-selective-review.ts audit NEW_DIR
```

初期ルール処理など同期区間は依然強制中断できない。成り候補ありのstand-pat時scoringとsortの費用、未検索の成り、ピン/合法取り返しの近似、wall-clockの揺れは残る。多数反復、別PC、一般棋力・対局への影響は今回未検証。マージの判断は独立再レビューへ委ねる。

## 変更ファイル（製品・検証・文書）

- `src/domain/shogi/quietPromotionSelection.ts`：共通resolverと玉位置走査の遅延。
- `src/domain/shogi/twoPlyAlphaBetaAi.ts`：spreadを廃止し正規化値を利用。
- `src/domain/shogi/quiescenceSearch.ts`：同じ正規化とstand-pat順序の依存コメント。
- `src/test/shogi-selective-review.test.ts`、`src/test/fixtures/selective-review-before.json`：新124回帰と旧HEADの96条件。
- `scripts/measure-selective-review.ts`：修正前後A/B/Cの保存・再集計。
- `README.md`、`LOG.md`、この技術文書、新run/validation/manifest：判断と未検証事項、原本保存。
- `.gitattributes`、`.gitignore`：新証拠とログのbytes/格納を維持。既存パターンを変更せず追加のみ。

## 最終検証・自己評価

- 新規124件が成功。96q条件、設定・走査・中断等28件。旧HEADからのfixture再生成96条件もbyte一致（SHA256 `b65c8aab34e6af07fe014242be3dc8bc6cf18bcb29de2eb5ff381282696608af`）。保存generatorを指定の一時パスへ戻し、第二引数に新規出力パスを渡せる。元fixtureはwxで上書きしない。
- 現在の関連9ファイル314件＝新124＋既存190件が全成功。現在の全体 `npx vitest run --dir src/test` は89ファイル2398件＝新124＋既存2274件が全成功（208.25秒）、skip/timeout/失敗0。jsdomのnavigation未実装警告は原ログへ保持。既存.worktreesを収集しない現在範囲を明示した。
- 前回PRのsnapshot timeoutは旧原本に保持。今回再現しなかっただけで、解消や原因同一性を断定しない。今回は全体timeoutがないため失敗ファイルの単独再実行は不要。既存assertion/期待値/timeout/worker数は不変。
- lockfile・TypeScript/lint・production build（1762 modules、24.38秒）成功、git diff --check成功。CIはpush後の最終HEADで確認し既存PR本文と最終報告へ記録する。ローカル結果とCIを混ぜない。
- 自己レビューでは選別なしのcutoff0/実選別数のskip、診断カウンターと中断確認の意味、王手/捕獲経路の不変更、設定のown/非列挙/継承/undefined/不正値/TT正規化、固定全結果とPVの一致、時限の揺れ、原本不変、変更範囲を確認。測定時の製品3ファイルと最終ソースbytesも照合する。
- P2-2の不整合は修正済みで、P2-1は理由付きの次善策まで。独立再レビューへ提出可能と自己評価するが、マージ承認や棋力/一般性能改善の保証はしない。既定OFFと研究用限定は継続し、マージ/自動マージを行わない。

最終格納hash検査helperの初回は、1MiB既定stdout bufferで約1MiB超の新fixtureを読む際にENOBUFSとなりmanifest生成前に停止した（validation/staged-verification-note.txtに転記）。検査helperだけのbufferを20MiBへ明示して再検査した。製品・測定・テストassertion/timeoutは変更していない。
