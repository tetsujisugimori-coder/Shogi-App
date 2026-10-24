# 連続交換・静止探索・SEEの調査と限定改善

関連Issue #209、先行 #207 / PR #208、#201 / PR #202、#177。基準main `376bcbabed2309d017b233b4a264504007f70db7` はfetch/ff-onlyで最新確認。開始時clean、専用 `codex/quiescence-quiet-promotions` で作業。既存worktree・旧測定原本は変更していない。

結論：非捕獲成りの欠落による浅い有限探索の選択差は再現・限定改善したが、短時間の完了深さ低下が多く、**既定OFFを維持する**。SEEの連続取り返し・成り・持ち駒の計算に新たな誤りは再現できず、SEE自体は変更しない。対局全体の棋力向上は未実証。

## 探索構造と変更範囲

|対象|既存実装と今回の扱い|
|---|---|
|通常→q|通常残り深さ0、明示的quiescence設定ありの場合だけ、同じαβ窓・root視点・plyでqへ接続。設定なし／root深さ0の契約は維持。|
|非王手のq|従来は合法捕獲＋stand-pat。今回 `includeQuietPromotions:true` で合法な非捕獲成りも同じ候補集合・同じq予算へ追加。成り捕獲を二重追加しない。不成・通常の非捕獲手・非王手での打ちは追加しない。|
|王手|残予算があれば玉移動・捕獲・合駒・持ち駒打ちの全合法応手。stand-patは使わず、新設定で絞らない。既存q0の静的境界と別予算evasion追加0〜2は維持。|
|SEE|同一着地点への合法取り返しを再帰。盤上喪失＋不成持ち駒獲得、成／不成、複数候補、唯一の応手の強制交換を扱う。他の合法手があれば現在のmaterial差で終了できる近似で、全応手の勝敗値ではない。|
|SEE順序・枝刈り|通常standardはSEEなし。static-exchangeの複数捕獲を手番側SEE降順で安定整列。深さ1 rootは元順序、負SEEも捨てない。qのoriginal/materialはSEEを呼ばず、SEE枝刈りはない。今回も追加しない。|
|終局・距離|共有の合法着手適用で終局判定。PV末端内訳・SearchValue終局カテゴリ・rootからのplyを維持。成り1手詰みをrootPly4→距離5で検証。有限末端を勝敗証明へ昇格しない。|
|期限・fallback|既存deadlineを渡し、ノード入口／候補適用前後で協調中断。新候補も同経路。SEEの既存再帰・合法手生成前後の中断を維持。完了反復優先、partial-rootのexact候補限定、fallbackの評価null・空PV、completedDepth/resultSourceの意味を維持。|
|TT/PV|q設定は既存TT identityに含まれ、表は呼出し内限定。新設定のTT ON/OFF・前反復PVヒントを照合。|

製品差分は既存q候補フィルタとオプション検証・伝播だけ。探索器・評価加算・交換専用cacheは新設しない。単独q APIは末尾booleanを追加、省略false。通常APIは `quiescence:{maxTacticalDepth:1,includeQuietPromotions:true}`。Worker/UI/保存形式・既定設定は不変。

## 局面と評価理由

座標は0始まり(row,col)。公開合法手列挙・適用で全PVを再生。疎な人工局面の未配置駒は盤外で、持ち駒に加えない。平手到達可能性を主張しない。

|代表条件|合法な手順・理由|結果|
|---|---|---|
|即時取り返し|poisoned-rook: 飛(5,4)→歩(4,4)、銀(3,4)→(4,4)。玉は(8,8)/(0,8)。|既存q/SEEで駒損を処理。|
|三段交換・持ち駒|上記に先手金(5,5)、金で銀を取り返すexchange-chain。|material差+200→−1800→−1000、SEE −1000。先手持駒は歩/銀、後手は飛。既存処理で十分。|
|成り捕獲|銀(3,4)が歩(2,4)を成／不成で捕獲。|既存SEEは候補ごとの盤上価値・不成の持駒価値を区別。既存テストを再利用。|
|大駒損得|poisoned-rookと、飛・角・香を含む既存see-deadline分岐局面。|SEEで合法手を捨てず、qの実着手で評価。各選択/値はraw保存。|
|王手・打ち|rook-check / gold-drop-evasion: 玉(8,4)へ後手飛(4,4)の王手、後者は先手金持駒。|金打ちを含む全合法応手数とq子ノード数が一致。|
|非捕獲成り欠落|PR #208のevasionと180度反転。先手玉(8,4)、後手玉(0,8)、後手飛(4,4)。玉(8,3)後は後手非王手・捕獲0、飛(6,4)成が合法。|旧qは予算1を残して静止。新qは成りを読む。|
|成って取られる|玉(8,8)/(0,8)、先手歩(3,4)、後手金(1,4)。歩(2,4)成を金で取れる。|q1では成りを好むがq2ではstand-pat。成りの単純加算をせず、取り返しを読む必要性と有限予算の限界を確認。|
|期限付近|平手初期＋see-deadlineなど同じ10局面、100/1000ms。|時限本測定240件は全completed-iteration。partial/fallbackは制御時計で別検証。|

evasionの旧root d1は玉(8,3)・−1005、ONは玉(7,3)・−1096へ変わり、旧normal d3の選択手に一致。反転も同じ。旧選択の直後を独立に固定した局所qでは、合法な非捕獲飛成で後手material +200（先手視点−200）を確認。先後／正逆順の枝刈りなし既存参照も新候補集合を指定してd1+q1の値を照合した。参照は製品ルールと評価を共有し、独立なルール検証器ではない。

改善は浅い順位であり、ONの−1096は旧d3の−1005と同値ではない。成り候補もq境界で取り返しを残し得る。100msのevasionは旧d3／新d2で同じ玉(7,3)、1000msはともにd4・−1205・同じ選択だった。有限horizon、非捕獲王手／打ち全般は未改善。勝敗の誤選択確定や一般棋力向上とはしない。

## 比較条件と結果

2026-10-23 20:07:14〜20:08:59 JST、Windows 10.0.26300 / i7-14650HX / Node24.20.0。元main srcをgit archiveで展開し候補版と同一processでimport、直列AB/BA交代。10局面×通常standard/static-exchange、標準評価、q1/original、evasion追加0、killer/PV/TT=false。固定d1と100/1000ms（通常最大d4）、各warmup1＋本3。API前後の実時間は中断作業を含み、局面作成・PV検査・起動は除外。診断OFF、テスト/buildを並行実行していない。親の20秒／1処理と全体6分は検証用で、製品期限の代替ではない。

560呼出し（warmup140＋本420）、別途d2診断40、互換照合20が完走。欠測・例外・親停止0。旧版とOFFの固定d1全60本は経過時間以外の全結果が一致。完全状態履歴・PV・内訳・入力非破壊・予定cell・ソースhashを検査し保存。

|指標（各順序30本）|before→ON|
|---|---|
|固定d1 qノード（両順序同じ）|81→282（+248.1%）|
|standard/100ms 完了深さ合計|86→75、改善0／悪化11／同じ19対|
|SEE順序/100ms 完了深さ合計|81→72、0／9／21対|
|standard/1000ms 完了深さ合計|108→107、0／1／29対|
|SEE順序/1000ms 完了深さ合計|104→103、1／2／27対|
|standard最大超過100/1000ms|0.963→2.573 / 1.591→0.850ms|
|SEE順序最大超過100/1000ms|1.130→0.727 / 1.034→1.272ms|
|別計測d2のSEEバッチ呼出し|standard 0→0、static-exchange 33→33（各10局面合計）|

SEE指標は既存SearchDiagnosticsの並べ替えバッチ数で、個々の捕獲／再帰回数ではない。通常/qノードは最終完了反復と完了反復合計を別保存し、中断作業を含まない。表の負の超過は時間枠より早い完了。OS/JIT/GCの変動を含み、反復は独立した対局標本ではない。

短時間の改善と悪化を両方保存した。1000ms/SEE順序/exchange-chainには1本深さ改善があった。一方gold-drop-evasionの同順序は2本悪化、中央値d4→d3。反転evasion/1000msの中央値はstandard 616.026→557.858ms、SEE順序616.518→537.633msでd4維持。元evasion/standardは314.609→432.719ms、100msでは両側・両順序とも中央値d3→d2。see-deadline/standard/100msはd2→d1。[全表](exchange-promotions-20261023-run1/results.md)、[選択手・評価・PV・全統計raw](exchange-promotions-20261023-run1/raw.jsonl)、[集計JSON](exchange-promotions-20261023-run1/summary.json)。

既定ONは推奨しない。同期の合法手生成・着手適用は確認間隔内で強制停止できず、観測された数ms以内の超過を厳密期限保証とはしない。残課題は成り候補増を抑える方法、末端の取り返し、非捕獲王手／打ち、独立な対局棋力検証。推測による枝刈りや評価重み変更は加えない。

## 再現と保存

```powershell
New-Item -ItemType Directory .diagnostic-temp/exchange-baseline
git archive 376bcba src --output=.diagnostic-temp/exchange-baseline.tar
tar -xf .diagnostic-temp/exchange-baseline.tar -C .diagnostic-temp/exchange-baseline
$env:TEMP = (Join-Path $PWD '.diagnostic-temp'); $env:TMP = $env:TEMP
node --import tsx scripts/measure-exchange-promotions.ts run .diagnostic-temp/exchange-baseline NEW_OUTPUT_DIR
node --import tsx scripts/report-exchange-promotions.ts NEW_OUTPUT_DIR
# 保存rawの再集計（探索なし）
node --import tsx scripts/report-exchange-promotions.ts docs/benchmarks/exchange-promotions-20261023-run1
```

比較用展開srcは旧テストも含むため、全体test前にその展開ディレクトリのみ削除。基準tarのgzip、製品2ファイル・SEE・runner・referenceの測定時ソースgzipとSHA256を保存。manifestは保存物のhash。集計CLIは未完走／欠測cell・重複・不正PV・ソース不一致を拒否する。

保存rawと測定時fixtureの説明文の三段交換「最後−800」は誤記。銀の標準価値は400で、正しくは **−1000**。局面状態・探索結果・測定処理は不変。原本は改変せず現fixture説明と回帰期待値を訂正した。測定後fixture差分はこの文字列のみ、製品ソースbytesは測定時と同じ。

## 検証記録

新規19件成功：先後再現・正逆全幅参照、成り後取り返し、同じq予算、全王手応手と打ち、SEE非使用、三段交換と持駒、中断伝播、partial-root／完了反復／fallback、成り詰みと距離、TT/PV、入力非破壊、不正設定拒否。既存assertion・timeout・worker数は不変。

初回checkは集計CLIがnullable評価内訳を狭い型へ渡してlint失敗。経過時間除去関数を最小構造型へ修正した。次の標準checkは既存 `.worktrees` 内の過去版まで収集し、過去版minimaxでtimeoutを2件、現在のUIでも1件出したため中止。既存worktreeを変えず `npx vitest run --dir src/test` で現在の全86ファイルを実行し、2243成功／既存2件timeoutで失敗した（UI 5.746秒、snapshot 5.479秒、各上限5秒）。全体成功とはしない。その後、関連9ファイル314件が全成功し、新規19件も最終の不正値テーブル補強後に成功。失敗2ファイルは別々に単独再実行して37件／24件が全成功。timeout・assertion・worker数を緩和していない。TEMP rename EPERMはworkspace TEMP/TMP指定で解消。lockfile検査も成功。最終lint/buildと保存原ログはLOG・PR本文へ記録する。

保存後集計を2回実行し、summary SHA256 `877bf1ce61a856d50ff41493cfe0fbe91b406950fc88c26696ca59f333a0e32d` が一致。manifest既存hashを検査してから再生成し、rawや過去原本の改変を受け入れない。製品2ファイル／SEEの現在bytesと測定時gzipは一致、fixtureは説明文の−800→−1000以外一致することも確認済み。自己レビューで予算・候補重複・SEE非枝刈り・王手応手・距離・partial/fallback・TT・測定分離を確認した。これは第三者レビューではなく、PRは独立レビュー待ちで止める。

最終 `npm run lint` と `npm run build` は成功（1761 modules）。`git diff --check` 成功。全体失敗／単独再実行／関連314件／新規19件／初回lint／最終lint・buildの原ログはrun1の `validation__*.txt.gz` に保存した。macOS固有確認はWindowsローカルでは未実施で、GitHub CIへ委ねる。
