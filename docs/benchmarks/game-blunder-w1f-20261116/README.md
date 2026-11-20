# Stage W1f — 生成物ライフサイクル・cache意味・安全停止

## A. 総合判定

**PARTIAL／結果B。NOT_READY、実比較NOT_TESTED、旧0／新0、Draft維持、マージ推奨NO。**
実効cache型の不整合を修正し、Node公開APIの観測器、原イベント結合器、限定した合成契約、改変拒否対照を追加した。実環境の許可契約は成立していない。生成経路の完全性、cache意味的安全性、実効config全体、排他的writerをPASSに変更していない。R8／H1～H4はUNKNOWN、S4／S5はNOT_TESTED。

## B. 開始HEAD／提出HEAD／tree

開始HEAD `53f913804b1bcd91c88decd0870b26a796d1f32b`、tree `4ec00e6c7d95290711ba3f8bfdedbbc59bc0bbdb`。branch `codex/game-blunder-diagnostics`。接続アカウント `tetsujisugimori-coder`、Issue #217 OPEN、PR #218 OPEN/Draftを確認。開始時の未追跡 `.tmp-tests/` は保全した。

固定比較対象は旧 `e1ccb1a2412e7faa86c2c1f60fdad1dca154023a`／新 `2a8a57b6ff207831c77ce62d27d3151eba7c1dc3`。新規pairは `../stage-w1f-20261116/pair-retry/`。source raw Git blobは旧2104／新2211ファイルをbinary `git cat-file --batch`で取得し、個別manifestと照合した。既存snapshotはコピー・修復・比較実行に再利用していない。

この文書自身のcommit SHAは自己参照になるため、最終HEAD/tree、commit後Git blob照合、最終CI headShaは別の `../stage-w1f-20261116/` 提出監査とPR/Issueに保存する。文書内の開始HEADを最終HEADと取り違えない。

## C. 変更ファイル

- `scripts/stage-w1e-contract.mjs`: legacy synthetic boolean fixtureを限定維持し、live resolved cache objectを検証する。
- `scripts/stage-w1f-cache.mjs`: cache形状、cacheDir、snapshot相対path、link、実在/不存在とphysicalの区別。
- `scripts/stage-w1f-observer.mjs` / `stage-w1f-probe.mjs`: sync/callback/Promise/FileHandleの公開APIとcollection-only観測。
- `scripts/stage-w1f-events.mjs` / `stage-w1f-audit.mjs`: 原イベントinvoke/complete結合、原バイト、clock、主体、rename候補、実測の再監査。
- `scripts/stage-w1f-contract.mjs` / `stage-w1f-check.mjs` / `stage-w1f-observer-check.mjs`: 合成限定契約、32改変、実API/11改変、link対照。
- `scripts/stage-w1f-cache-semantics.mjs` / `stage-w1f-real-cache-check.mjs`: 保存したVitest source-backed意味実験、開始Git sourceとWindows実測同一入力のRED→GREEN。
- `scripts/stage-w1f-tools.mjs` / `stage-w1f-run.mjs` / `stage-w1f-evidence.mjs`: 準備、失敗を含むCLI原票、保全、raw gzip、独立process readback。
- `.github/workflows/stage-w1-verifiers.yml`: W1f合成/公開API検証を追加。`.gitignore`: 原JSONLだけを限定除外し、同一bytes gzipを提出。
- 本ディレクトリ: 実測、失敗原票、負対照、review、manifest。製品コード、package/lock、worker、timeoutの変更なし。

## D. P3-W1e-01

型不整合の修正はPASS。`cache:{dir:...}`を`true`へ書き換えていない。許可するresolved objectのkeysはdirのみ、absolute path、cacheDir一致、snapshot内path、祖先link不在、実在する場合のdirectory種別を検証する。唯一のpath正規化はsnapshot prefixからのrelative path化であり、case foldingや任意cache除外はしない。pairのrelative path一致と物理的共有を検査する。Node/cwd/固定HEAD順、bindings、出力未使用の既存検証は維持。

合成同一入力 `cache-red.json`→`cache-green.json`、実測旧新版同一設定入力 `cache-real-red-green.json` で開始Git sourceのSETTINGS拒否から型修正後の設定検証PASSを確認した。後者のlegacy実行copyはdependency import URLだけを変更し、元Git blob／全bytes／SHAも別保存している。

ただし今回のcollectionでは実際の結果cacheディレクトリは全stageで不存在。**設定抽出PASS、実体はUNKNOWN、cachePairはPARTIAL**。`physical:null`と`directoryState:absent`、保存予定の`projectedPhysical`を分離した。先行auditでprospective pathをphysicalとしていた原票は保全し、`*-physical.json`を最終判定とする。全面閉鎖は不可。

## E. P3-W1e-02

run/trial/head/PID/preSeal、invoke/completeのcallId、operation、before/after path、wall-clock、PIDごとのmonotonic clock、size/SHA/base64、stack、方法/限界、close、残留を記録。原JSONLを直ちにappendし、メモリ内最終配列だけに依存する方式を改善した。ただしfsync済み耐障害journalという保証はない。

公開APIのsync/callback/promisesと取得したFileHandleのwrite/read/close等が対象。既存binding、native内部、worker、別process、OS操作の完全捕捉はUNKNOWN。observer自身のreadはstackでevidence-samplerに分類しconsumer条件から除外する。clockはwallとPID別monoを分離し、異processのmonoを比較しない。mtimeは発生時刻の証明に使わない。

Windows各909events／454calls。`*-event-analysis-physical.json`はOPERATION_FAILED／LIFECYCLE_INCOMPLETEでUNKNOWN。close自体は成功・cleanupErrors空。Node APIを越えた完全な来歴は未成立であり**閉鎖不可**。

## F. atomic rename・生成主体

各63件の.tmp→最終hash名のrename API候補をwriteと結合できた。原バイト一致だけでrenameを認定しておらず、invoke/completeとfrom/toを要求する。最終名のsampler readとunlinkも記録したが、application consumer readを含む完全chainは各0件。

先行auditのobservedChain各63件はsamplerを含んでいた。独立レビュー後の再監査で各0へ訂正し、先行原票は削除していない。API PIDは記録したが、排他的生成主体、atomic OS rename、競合不在、native/別主体の介入不在はUNKNOWN。OS全体のprocess不在は主張しない。

WPR/logmanは既設、Procmonは見つからず、read-only `wpr -status`は記録中でないことを返した。管理者tokenではなく、traceの品質/権限を確立していないため取得を開始していない。ツール導入、権限設定変更はしていない。

## G. 結果cache意味

Vitest 4.1.11のinstalled source全bytesを保存し、ResultsCacheとBaseSequencer.sortの実際のmethodを抽出して合成実行した。file IDはproject名＋root相対file pathであり、assertion IDではない。値はdurationとfailed、version。durationはfile.resultから取得、negativeは0へ補正、failedはstate===fail。明示的な実行回数fieldはなく、同fileは更新、非選択fileの前回値は残り得る。

readFromCacheによる前回値復元と、failed優先／duration降順の実行順変更を実測した。生成はwriteToCache時、runFiles内pool.runTests後にupdateResults/writeToCacheが呼ばれる。これらのmethodでは保存結果をassertion結果の代替として使っていないが、順序を変えるため時間・間欠失敗への影響は除外できない。

今回のcollection-onlyではS1/S2/S3/closeすべて結果cache entriesが空で、結果cache生成の実環境試行はNOT_TESTED。旧新版の意味的安全比較もNOT_TESTED。source-backed合成意味実験PASSは差分の無害性を示さず、反対に順序への影響を確認した。成功/失敗・durationの変更をCACHE_RESULT_CHANGEDで拒否し、差分許可は追加していない。**cache安全条件NOT_ESTABLISHED**。

## H. 実効config

Windows Node 24.20.0／npm 11.17.0／Vitest 4.1.11、maxWorkers2、5000ms、jsdom、setupFiles、cache有効の実測設定を保存。旧新版のsource、lock、初期dependencies、settings、collection inventoryは同等を確認した。TEMP/TMP/npm cacheは別専用path、snapshotとdependenciesは物理的独立。Node実体/hash/cwdも保存した。

snapshot prefixのみ正規化したfullConfigに `vite.webSocketToken` と `vitest.api.token` の2差分が残る（`config-diff-physical.json`）。新たな無条件例外にしない。serializerはclosure/native状態を証明できないため、完全な実効config同等性はUNKNOWN。初期の単発shell診断 `config-diff.json` はslash処理不備でpath差分を残した原票であり、最終診断ではない。

S1/S2/S3/closeのwalk時間・memory、observer read bytes、journal IO時間を保存した。各observerは約17.7MBを追加読取り、instrumented全時間は約114.6秒／81.7秒。非計測baselineを同一条件で取得しておらず、時間/メモリの差分効果はUNKNOWN。walkはnon-atomicでaccess metadataへの影響もあり得る。

## I. 正常・負対照／RED→GREEN

W1f合成は正常1＋32改変。cache型/値/実体、PID、operation、rename from/to、bytes/hash、欠落/順序/window/trial、非対称、link/循環、未知file/type、cache failed/duration、output、seal/request/assessment、Node/cwd、pair順/HEAD、close失敗/中断、不完全writer、mono domainを具体的なexpected reason付きでassertする。単なるexit1はPASSにしない。

実公開API対照はsync/callback/Promiseのwrite→rename→read→unlinkとFileHandle.closeを実測し、11種の原イベント改変reasonを検証。live cache path/type、junction/danglingも通常Windows権限で3/3 PASS、独立担当も3/3 PASSを再取得した。sandboxのEPERM失敗原票も保持した。

独立担当が再入障害のRED（1byte readが終了せず約22MB記録）と、結合器の5偽PASSを固定。再入抑止・未知operation・close/open fd・read/unlink状態の修正後、同じ独立原票でGREEN。さらにsampler混入を除外した実測再監査ではUNKNOWNとなることを確認した。合成契約はtrusted入力の照合であって、live実環境の許可契約ではない。

## J. 実比較

**NOT_READY／NOT_TESTED、旧0／新0。** W1f gateに実比較spawn経路はない。collection子process、製品回帰、tiny正常対照は固定旧新版の実比較件数へ含めない。全sealが成立したとの認定はしていない。実環境許可の独立レビュー未成立を含め、1条件でも欠けたため比較を開始していない。S4/S5 NOT_TESTED。

## K. 回帰・正式CI

Windows W1/W1b/W1c/W1d/W1e/W1f合成＋公開APIは139tests中137PASS／2SKIP、0FAIL。SKIPをPASSに変換しない。別の通常Windows権限による公開API/link対照は3PASS／0SKIP。旧P2対照14casesと接続正常対照、tiny正常/duplicates・assertion failure・runtime error対照、mutation偽PASS検出、生成物12拒否対照が期待通り完了した。

lock、型検査、build、関連pilot2tests PASS。製品全体は**98files／2587tests PASS**。既定探索の別試行は保全中の.tmp-testsも収集し159files中9failed／150passed、2688tests中2failed／2686passed、2errorsでFAIL。原stdout/stderr/終了状態を保全し、製品98files試行へ混ぜていない。timeout延長・worker変更による回避なし。

初回snapshot準備はNode隣接npmの版不一致でinstall前に停止した。npm 11.17.0実体を固定し、別の未使用pair/outで再構築。sandbox内junction作成で止まったgenerated/runtime原票も維持した。通常Windows権限で新規領域へ再実行し、権限設定変更をしていない。

正式Ubuntu/macOS CIと専用CIはこの文書のcommit/push後に取得・全headSha照合してPR/Issueへ提出する。既設CIのNode設定24.19.0はWindows24.20.0と異なり、同一環境の証明として扱わない。CI結果を見ないまま最終成功とはしない。

## L. 原本保全・独立照合

既存W1～W1e、旧snapshot、失敗原票、.tmp-tests等22root／177184entriesの原本manifestを保存し、別processで再取得して全件unchangedを確認した。linkは追わない。原本の削除・移動・上書きなし。大容量install/TEMPは案件専用領域を使用した。

W1f原イベントはlocal原JSONLを維持し、同一bytesのlossless gzipをGit提出する。source、原バイト、manifest、回帰、失敗、独立reviewを保存する。提出manifestの全bytes/SHA/base64を別processで再読し、commit後はbinary Git blobから再取得する。post-commit監査・CIは同じW1f専用外部領域に保存する。

observer実装sourceの記録は観測後readbackであり、認証されたpre-run source sealではない。hash一致だけでは歴史的実行の真正性、排他的writer、観測漏れ不在を証明しない。既存sourceの署名済み履歴を新たに捏造することはしない。

## M. 独立レビュー

実装担当以外の独立担当がコード、実際の負対照、実測原票、cache source、P2変更不在を確認した。`independent-review.md`、2版のreviewed-source SHA一覧、独立CLI原票を参照。実装担当の自己検証を独立PASSへ数えていない。指摘後の変更に対して再レビュー済み。

P3-W1e-01は型修正確認／実体UNKNOWNでPARTIAL、P3-W1e-02は閉鎖不可。cache意味、config全体、排他的主体、atomic OS操作、完全chainが未解決。既存P2閉鎖の維持を妨げる新反例は確認されず、製品/P2実行器の拒否条件は変更していない。最終Git/CI照合はcommit後の独立process監査として区別する。

## N. 次工程・マージ推奨

許可されたOS観測方法と証拠品質の確立、native/workerを含むconsumer chain、実在結果cacheの生成/再利用/差分の比較影響、完全configとpre-run source/sealの固定が必要。安全条件を緩めて比較へ移行しない。結果B／比較0、R8/H1～H4 UNKNOWN、棋力改善NOT_TESTED、Draft維持、**マージ推奨NO**。

記録日: 2026-11-16 JST。最終提出日時はPR/Issueと提出監査に記録する。
