# Stage W1e — 結果B / PARTIAL / NOT_READY

## A. 総合判定

**PARTIAL、マージ推奨NO、Draft維持。** 新規独立pairを構築し、WindowsのTEMP/cache観測基盤、候補限定契約、正常/負対照、実行主体・pair検証、回帰、証拠保存を実装した。安全な実環境許可条件は未成立。旧新版比較old=0/new=0、S4/S5 NOT_TESTED。98ファイルのABBA比較は実施していない。

## B. 対象・開始状態

Repository `tetsujisugimori-coder/Shogi-App`、Issue #217、既存OPEN Draft PR #218、`codex/game-blunder-diagnostics`。開始HEAD `27b83e8300460de992060d439ac77c8680ed32ba`、tree `9ce0b2e05dce4222425761225b1900194891f514`。ローカル/remote一致。接続アカウント `tetsujisugimori-coder`。開始時追跡差分なし、未追跡は既存 `.tmp-tests/` のみ。コネクタ利用不可、sandbox内CLI通信失敗の後、許可済みネットワークで認証・PR・refsを確認した。新ブランチ/PRを作成していない。最終HEAD/treeとCI headShaはcommit後のPR追補と外部readbackに記録する（自己参照を避ける）。

## C–D. 変更範囲・既存P2

追加 `scripts/stage-w1e-*.mjs` と本証拠ディレクトリ、専用workflowの対照追加のみ。製品コード、package/lock、5000ms、2worker、従来runnerの厳格sealを変更していない。既存P2-W1c-01/02は**PASS/閉鎖維持**。旧21誤PASS、18既存保護、正常2試行を既存W1d回帰で維持する。`start-review.json` は指定された独立レビュー原文。

## E. Windows観測

`build/` は旧 `e1ccb1a2412e7faa86c2c1f60fdad1dca154023a`、新 `2a8a57b6ff207831c77ce62d27d3151eba7c1dc3` のraw Git blobから独立生成。Node v24.20.0 / npm 11.17.0 / Vitest 4.1.11、両npm ci終了0、全依存各13,642エントリ。既存snapshotをコピー/修復していない。実行TEMP/TMP/npm cacheは旧新別ディレクトリ。インストール用環境とも区別。

| 時点 | 内容 |
|---|---|
| S0 | 各npm ci終了後、source inspectionの後に全依存・install TEMP/cacheを記録。インストール中の完全な変更追跡ではない |
| S1 | config直前。source raw hashes、依存全種別/hash/size/絶対・相対パス、実行環境を保存 |
| S2 | config直後。全enumerable resolved config、関数source、設定抜粋、cache実体パスを保存 |
| S3 | 同じ `src/test/game-blunder-pilot.test.ts` の収集後。各2tests/2suites、TEMP各65エントリ（2directory/63file）、全63fileのraw bytes/hashを取得 |
| close | 各63fileの削除前raw bytesとunlink呼出PID/時刻/stack、削除後欠如を記録。TEMP残留各0。`.vite-temp` 空directoryは残る |
| S4/S5 | NOT_TESTED、安全条件未成立 |

各268 APIイベント。Vite一時mjsとTEMPの一時 `.tmp-*` 書込みもraw bytesを取得。ただしatomic renameは観測しておらず、`.tmp-*` から最終hash名への生成経路、directoryの生成主体、OS全体の排他的writerは**UNKNOWN**。hash一致だけからrename/無害性を断定しない。生成時刻はAPI時刻またはendpoint間の範囲。ファイルシステムmtime/birthtimeを原因発生時刻と混同しない。

`probe/*.json.gz` は原endpoint、`probe/*-events.json` は原API記録、`*-temp-provenance-final.json` はファイル別索引。`observation-analysis-final.json` が最終集計。初回集計のcache===true判定は実際のcache `{dir}` を誤ってfalseとしたため原結果を残し、dirとcacheDirの照合に修正した別集計を保存した。`-reviewed` 集計も削除しない。

観測器はファイル読出・gzip書込・同期predelete読出で干渉する。endpoint inventoryだけで約0.83–1.40秒、全体時間・前後memoryUsageは原記録にある。非原子的walk、アクセスmetadataへの影響、別process/native API漏れ、強制終了でのmemory event喪失が残る。**無観測性能との同等性UNKNOWN**。初回正常観測後にclose失敗時の保存処理を強化した。異常closeを実Vitestで再現した試行はNOT_TESTED、独立コードレビューで確認した範囲。

## F. 限定許可契約

`stage-w1e-contract.mjs` の固定 `CONTRACT` とSHAが契約。**合成候補に限るPASSで、実環境admissionではない。** 許可候補はS1→S2にinstrumented-node-apiが新規作成する、snapshot配下の正確な `node_modules/.vite-temp`、regular empty directory 1件だけ。前在状態null、after/residueともempty、absolute/relative containment、同一試行ID、開始/終了内時刻、sealed対象PID一致、旧新対称性を要求する。再利用なし、別試行/出力の再利用なし。source・request・assessment・契約・対象metadataの改変は拒否する。caller-held sealsを信頼境界とし、全入力とsealを共に捏造できる攻撃への歴史的真正性は主張しない。

一時mjs、TEMP file、results cache、未知directory/link/junctionは許可しない。時刻は検証した実行window内のみ、random filenameの例外なし。directoryのendpointだけからその内部の一時変更を許可しない。違反は専用reasonを伴うthrow、呼出側ログに保持、比較起動なし。合成成功でも `gate()` は常にNOT_READYを返す。実際のproduction runnerにはこの候補例外を接続していない。契約を実環境で安全に接続できないための意図的停止であり、実比較用正常受理はPARTIAL。

## G. 正常RED→GREEN・負対照

同一合成正常入力を従来の `requireUnchanged` が拒否するREDと、候補validateがPASSするGREENを保存。厳格検証自体を変更していない。正常REDの実行は候補コードの作成後、同じ検証内でGREEN適用前に行った。コード実装より前にREDを保存したという時系列要件は**PARTIAL**であり、事前実行を捏造しない。

`controls-reviewed.json` / reviewed-controls-cli: **34/34 PASS**。15要求カテゴリに加え、assessment単独、PID同時書換、時刻window、絶対パスescape、未知内容field、Node実体hash/version/path/cwd、pair順序/HEAD、同一物理実体、出力再利用等。各負対照は特定reasonの完全一致をassertし、単なるexit 1を成功扱いしない。これらはpure-validatorの対照（spawn APIなし）であり、OS上のプロセス不存在証明ではない。

別途、従来runnerの実CLI厳格seal対照12件を `generated-cli` と `generated-controls.json.gz` に保存。実際のjunction/cycleを含み各exit1/spawn0。ただしこれら旧対照の一部は依存tree不一致で先に拒否するため、個別新契約reasonのPASSには流用しない。新契約の15カテゴリPASSは上記pure対照の範囲。実環境の各異常の完全なend-to-end再現はPARTIAL。

## H–I. 同一性・比較

Node実体raw hash、version/path/cwdの開始値とgate評価時値、probe各cwd、旧新HEAD順序・物理snapshot/依存独立性、source/lock/初期依存、2worker/5000ms/jsdom/setupFiles、cache enabledとdir実体、TEMP隔離、inventory同等性、未使用比較出力を照合（最終checksは全true）。npm固定versionは独立installログ、Vitest固定versionは各snapshot検証。resolved config全体のclosure/private/native stateの同等性はUNKNOWN。実launchは行わないため「実launch主体一致PASS」とはしない。Node/cwd/pair誤指定は合成identity対照で比較spawn前に拒否。同一HEADは実モード拒否、明示fixtureモードのみ保持。

TEMP変換内容の意味・生成/rename経路、cache結果/時間の制約が未成立のため、**NOT_READY、実比較NOT_TESTED、old=0/new=0**。候補正常が通っても結果cacheの時間/成否を可変値として許可しない。独立レビューも結果B停止範囲のみ。

## J. 回帰・CI

lock/typecheck/build/関連pilot 2testsはPASS。初回default全体実行は既存 `.tmp-tests` の故障fixtureも収集して159files中9failed/150passed、2failed/2686passed、2unhandled errors、exit1。全原ログを `validation/` に保存。Windows間欠障害の再現とは認定しない。W1dと同じ `src/test` 製品全体の別試行を `full-product-cli/` に保存し、98files/2,587testsすべてPASS（exit0）。成功まで同じ試行を反復した扱いにはしない。

既存admission/P2と新候補の最初の複合回帰は101PASS/1Windows symlink SKIP、最終複合回帰は102PASS/1SKIP/0FAIL（verifiers-reviewed-cli）。別junction対照は実行済み。mutation検出PASS。CIは最終push後に専用Ubuntuと正式Ubuntu/macOSをheadSha照合し、原ログを別案件領域に保存する。CI成功でP3/R8/HをPASSにしない。

## K. 保全・レビュー

`preserved-before.json.gz` / `preservation.json` は既存 `.tmp-tests` 6,817エントリ、W1c/W1d証拠、Stage W1とW1c失敗01/02・成功03とW1d pair全treeを前後再hashし、8root全て不変。既存追跡原本はGit差分でも確認する。新大容量原本はworkspace sibling `stage-w1e-20261116/` に保持し、勝手に削除しない。npm/node_modulesは固定HEAD/lock/commandsから再取得できるが、その再実行が原時刻やTEMP原本を再現するとは主張しない。原TEMP bytesは本証拠へ保存している。

`stage-w1e-evidence.mjs seal` が全証拠raw SHA-256 manifestを作り、JSON/gzip内base64のSHAも照合。`git` modeがcommit後にbinary Git blobから全manifest entryを読戻す。自己参照するmanifest/readbackだけをmanifest対象から除く。commit後結果は外部readbackとPRに記録。

独立別agentがコードレビューと34対照再実行を実施し、結果B停止範囲PASS。`independent-review.md` に指摘と修正、未実施範囲を明記。別Windows実機の再観測、全証拠Git blob独立再hash、最終HEAD CI独立照合はPENDING。

## L. 未解決・次工程

P3-W1c-01 **PARTIAL/未成立**、R8/H1–H4 **UNKNOWN**、実比較 **NOT_READY/NOT_TESTED**、S4/S5 **NOT_TESTED**。生成物の意味・atomic renameを含むライフサイクルと主体・cache成否/時間を拘束する独立検証が必要。広域除外やconfig/cache無効化で通過させない。失敗default suite、初回cache誤判定、未検証終了異常を隠さない。main commit/force-push/Draft解除/merge/auto-merge/branch削除は実施しない。

再現（新規root/出力必須）: W1C_NPM_CLIをnpm11.17.0に固定し `node scripts/stage-w1e-snapshots.mjs NEW_PAIR NEW_BUILD` → `node scripts/stage-w1e-prepare-probe.mjs NEW_BUILD/limited-plan.json NEW_PLAN` → `node scripts/stage-w1e-probe.mjs parent NEW_PLAN NEW_PROBE`。開始actor記録とaudit入力ディレクトリを本件の構成に合わせて別名で構築する。対照は `node --test scripts/stage-w1e-check.mjs`、複合回帰は専用workflowと同じコマンド。source・依存の膨大な読出時間を考慮し、観測性能を比較値として利用しない。

2026-11-16 JST
