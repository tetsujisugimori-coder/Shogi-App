# Stage W1g — 実行来歴と比較開始ゲート

## A. 総合判定

**PARTIAL／結果B。固定旧新版の比較開始ゲートは BLOCKED、比較起動は旧0／新0。Draft維持、マージ推奨NO。**

点検用の事前バイト封印、隔離した実 Vitest 対照、診断用ゲートと旧起動経路の拒否を実装した。独立した封印認証、欠測を管理したカーネル来歴、意味的消費、実効設定全体の受入条件が未成立のため、比較は停止する。

## B. 開始点と比較対象

開始ブランチ `codex/game-blunder-diagnostics`、HEAD `4d84a6ffe6955d02d9e2f02648943d5989ee6fb0`、tree `ca1039fd4363223a265d47e9a462e6a3a7b9542f`。[PR #218](https://github.com/tetsujisugimori-coder/Shogi-App/pull/218) は OPEN/Draft で HEAD 一致、[Issue #217](https://github.com/tetsujisugimori-coder/Shogi-App/issues/217) は OPEN。開始時のレビューの未解決スレッドは0件。W1f 独立レビュー本文の P3-W1e-01 PARTIAL、P3-W1e-02 OPEN を引き継ぐ。開始HEADのUbuntu/macOSと専用CIの成功は W1g の CI 判定に流用しない。

固定旧は `e1ccb1a2412e7faa86c2c1f60fdad1dca154023a`、tree `5ced08e0036f955833ca2e12722bfbd595a00afd`。固定新は `2a8a57b6ff207831c77ce62d27d3151eba7c1dc3`、tree `3d06ccd81473b78bc3eb721c516693042ae2c118`。最終 HEAD/tree、レビュー、CI と原票照合は既存 PR/Issue の提出報告と Windows 案件アーカイブに記録する。

## C. 実装範囲

- `stage-w1g-gate.mjs` は必須条件と拒否理由を明示する。実環境の入力に使える独立検証系が存在しない間は BLOCKED。
- `stage-w1g-seal.mjs` は固定対象の非起動・read-only 点検。プロジェクト、対象 snapshot、依存先に出力しない。
- `stage-w1g-cache-fixture.mjs` は生成した2テストだけで実設定、結果cacheのバイト、キューと worker 内のテスト開始、終了を記録する。
- `stage-w1g-check.mjs` と専用CIに対照を追加。W1b の runner/worker に固定HEADと同一treeの起動拒否を加えた。元のABBAスクリプトの現行入口も拒否する。過去の記録の offline verify は残した。
- 製品探索・評価・将棋規則、package/lock、既定5000msとmaxWorkers 2、strict seal と既存のP2拒否条件を維持した。

## D. 事前 source seal — PARTIAL

Windows の固定 snapshot で、各 Git commit/tree と replacement を無効にした Git tree の blob ID、worktree 原バイトの Git blob ID と SHA-256、依存ツリーの digest、lock、Node 実体、対象/依存の realpath・volume/inode・birthtime、許可対象の環境値の digest、点検器ソース、計画、PID/PPID/開始時刻/cwd を保存した。点検の開始記録を manifest の raw SHA-256 と challenge に結び、終了時に同じ原本を再取得した。対象の実効設定はこの read-only 点検では NOT_TESTED。W1fの collection 設定は別原票として参照する。

生成者と測定者は同じ権限で書き込み可能。固定 Git オブジェクトはソース内容の独立した比較基準になる。Node、実測時の依存、環境、イベント時刻と点検器ロードの真正性は、外部署名や独立管理の one-use challenge と同等には保証できない。事前照合の結果は点検時のバイト一致に限定する。歴史的実行の真正性は UNKNOWN、独立認証は BLOCKED。隔離fixtureも同じ権限境界で、依存の照合は選択した Vitest/Vite 実ファイルと lock の範囲。

## E. Windows 観測 — BLOCKED

Windows の低整合性トークンで読み取り照会した。WPR 10.0.26100 は General/DiskIO/FileIO profile を列挙し、記録なし。logman は Kernel-File と Kernel-Process の provider/keyword を列挙し、ETW collector の稼働は確認されなかった。Analytic と Security の event channel は exit 5。ProcmonはPATHで未検出。Windows 標準の読み取りで C: は Fixed NTFS と観測した。追加インストール、管理者昇格、監査ポリシー変更、trace session 起動は行っていない。

| 観測手段 | 利用・必要権限 | 記録の範囲と保存 |
| --- | --- | --- |
| WPR / ETW | profile と provider の照会のみ。必要なカーネル採取と読み出しを現在のトークンで確立できていない | PID/TID、process start と file operation 開始/終了、IRP、FileObject/FileKey、名前を結合できる可能性がある。Windows worker のアプリ内ID、write/read内容の意味、無欠測は別証拠が要る。ETL と採取構成、clock domain／校正、バッファ欠測、開始・終了を保存すべき。負荷・時刻精度とも今回 NOT_TESTED。 |
| Windows Event Log | 対象 channel 読み出し拒否 | 監査設定の範囲に依存。記録対象、process/handleの対応、rename completion と欠測は未確立。利用時は EVTX/XML と channel 設定を別保存。今回の時刻精度・負荷は NOT_TESTED。 |
| Procmon | PATHで未検出。driver・既設状態と権限を確認できず BLOCKED | process/thread、handle、rename、欠測、時刻・負荷は今回未観測。PML/採取構成はなし。 |
| Node / worker | 隔離fixtureで fork のPID/PPID/timeOrigin/threadId/binary、Vitestキューと worker 内のテスト開始を採取 | Node とworker自身の JSONL であり、OSの writer/event と照合していない。native、別プロセスの書込みやカーネル操作の完全捕捉は UNKNOWN。親の単調時間で所要時間を記録し、別process間の時刻順の厳密証明、無計測時との負荷比較は行っていない。 |

[Microsoft ETW File I/O](https://learn.microsoft.com/en-us/windows/win32/etw/fileio) · [FileIo_Info のフィールド](https://learn.microsoft.com/en-us/windows/win32/etw/fileio-info) · [WPR コマンド](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/wpr-command-line-options)

## F. atomic rename と排他的 writer — UNKNOWN

Node API の完了を、カーネルで観測した原子的状態遷移に換算しない。NTFS観測からは具体的操作の syscall/flags・両名のvolume/file identity・競合・可視状態・耐障害性を確認できない。採取が始まる前の活動、イベント欠測、監査権限、native と他processを含む writer の排他性は未立証。PID alone を主体の確定に使わない。 [Windows MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa)

## G. consumer chain — UNKNOWN

W1f の保存済み原票を参照。旧新版各909 events／454 calls、部分成立の rename API 候補各63、完全 chain 各0、候補のうち UNKNOWN 各63。sampler read は除外する。W1g で対象の新規 OS 連鎖は NOT_TESTED。要求 → 一時file作成 → 書込み → 完了 → rename要求 → 完了 → 最終 file identity → application read → 意味的利用 → 削除/残留の各段を同一 file identity、主体、原バイト、時系列で立証する条件は未成立。fixtureのcache由来のキュー順は別対象であり、この rename chain の件数に含めない。

## H. Vitest 結果cache — 参照経路を観測、許可条件 NOT_ESTABLISHED

Vitest 4.1.11 の `ResultsCache` と `BaseSequencer.sort` を固定して実行。cache ファイルは実効の `cacheDir/vitest/<project-name SHA-1>/results.json`。project名＋root相対パスがID。実装は起動時に読み取って順序に使い、実行後に結果を書き戻す。未選択の旧IDは残り得る。生成時のraw bytesとSHA、再利用、file IDと旧版cache、破損、中断、cache無効、物理共有とjunctionの対照を案件アーカイブに保存した。キュー順とは別に worker 内のテスト開始と reporter 完了を採取した。正常 seed は b→a、failed のみ変更・duration のみ変更はいずれも a→b。中断はキュー取得後・worker 起動前に exit 84 で、close は未観測、cache の原バイトは保持。破損 JSON は初期化時に内部処理され、テストは通過し正常 JSON に書き戻された。無効の対照は seed を残し、clearCache 対照は生成後に results.json を削除した。junction と共有はそれぞれ CACHE_LINK と CACHE_SHARED で拒否した。試行結果と実行時間は比較承認に転用しない。failed/durationに対する既存 `CACHE_RESULT_CHANGED` 拒否を維持する。

## I. 実効config — UNKNOWN

W1f の fullConfig 差分2件を installed source で追跡した。Vite 6 の `vite.webSocketToken` は9バイトの乱数由来の base64url で、HMR クライアントに注入され接続検査で比較される。Vitest の `vitest.api.token` は `crypto.randomUUID()` から生成され、project構成に渡り API WebSocket の接続検査に参照される。隔離fixtureは解決値のdigestを取得する。既存の比較で各経路が使用されないこと、閉包変数、plugin hook の到達性、native module 状態、環境・process依存値全体の同等性は UNKNOWN。両tokenを正規化で除外しない。

## J. ゲート — BLOCKED

ライブ入口は過去の `READY` ファイルも caller の verdict も受け取らない。起動要求時に必要条件の欠測を判定し、レポートを書き換えても動作は変わらない。合成契約は正常対照で READY を返し、必要条件ごとの INVALID／BLOCKED／NOT_TESTED／UNKNOWN と全体 NOT_READY を区別する。独立した証拠検証器と別途の開始承認が必要で、現行の固定比較の起動経路からは呼び出せない。OS全体や、過去commitのコードを別途手動実行する操作には、このリポジトリ内のガードは及ばない。

## K. 故障注入

合成入力は期待拒否理由を照合。seal欠落/改変/再利用、時刻逆転・未来、同PID異主体、worker/OS欠測、外部writer、rename途中、API readだけ・sampler、failed/duration/共有、token/closure、途中終了、環境変動、レビュー未完、期限切れ、出力再利用を含む。サンプラー判定を無効化した同一入力は mutant が誤READY、現行が `SEMANTIC_CONSUMER_MISSING`。起動プロセス対照は保存済みREADYの持ち込み、両固定SHAの旧runner/worker起動を理由付きで拒否。実OSイベント欠落・外部writerの実測再現は NOT_TESTED。

## L–P. 回帰、証拠、独立レビュー、次工程

Windows 基準 Node 24.20.0／npm 11.17.0／Vitest 4.1.11。98ファイルの製品試行は追跡下 `src/test/` を指定し、過去の既定探索159ファイル試行および退避中の `.tmp-tests` 原票と分離する。製品試行は98ファイル・2,587テストがPASS。Windows詳細は `evidence.json`、最終 GitHub CI は提出コメントを参照。CI は各runの `headSha` を最終HEADと照合する。

Windows原票は案件内 `../stage-w1g-20261118/` に保存。GitHubにはコード、報告、選定した機械可読の結果を置く。フル原票、CLI stdout/stderr、前後 manifest と独立再取得結果、説明付き失敗試行、CIログは案件アーカイブに置く。SHA一致は保存バイトの照合。外部タイムスタンプや書込権限分離は未成立。

比較旧0／新0、S4/S5 NOT_TESTED、R8/H1～H4 UNKNOWN。認可された完全性付きOS採取、外部に固定したseal、実対象の意味的消費と実効config、最終入力への独立承認が残る。正式比較の可否を再評価するまで **Draft維持／マージNO**。
