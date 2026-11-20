# Stage W1f independent review

Reviewer: implementation agentとは別の `independent_review` agent。自己検証結果を独立PASSとして転用していない。判定は **PARTIAL / 結果B / NOT_READY**。限定実比較の開始は許可しない。Draft維持、merge推奨NO。

## 独立して実施した反証と再検証

- 初版observerの1バイトreadで、snapshot → readFileSync → wrapped openSync → snapshotの再入を再現。約22MBの記録を生成して処理が完了しなかったため中断。原票 `../stage-w1f-20261116/review-observer/events.jsonl` を保存し、削除していない。再入抑止後、同種のread/write/rename/unlink正常対照は15events / 7callsでPASS。
- 新結合器の初版で、renameのinvoke/complete双方のoperation改変、cleanupErrors追加、openDescriptors追加、read完了のfile→absent改変、unlink直前のfile→absent改変がPASSになる反例を独立作成した。修正後、同じ原イベントを使ってUNKNOWN_OPERATION / CLOSE_ERRORS / OPEN_DESCRIPTORS / LIFECYCLE_INCOMPLETEを期待理由として確認。原票と前後assessmentは `../stage-w1f-20261116/review-observer-fixed/{events.jsonl,analysis.json,analysis-reviewed.json}`。
- W1e＋W1fの合成対照67件を独立プロセスで再実行し67PASS。ただしこれは合成入力の検証であり、実環境admissionのPASSではない。
- 最終のobserver-checkを独立再実行。同期・callback・Promise/FileHandleと原イベント改変対照、live cache path/type対照、実junctionとdangling target拒否の3 testsが3PASS/0SKIP。原票は本ディレクトリ `independent-observer-controls/`。通常Windowsユーザーtokenのままsandbox外実行経路を使用し、管理者昇格・権限変更はしていない。先行するsandbox内のjunction作成失敗（ENOENT/EPERM）も `../stage-w1f-20261116/review-cache/` に残した。
- public fs API wrapperの再入抑止、fileURLToPath使用、FileHandle.close後のfd追跡削除、dangling linkへのlstat実施をコードで確認した。

## P3-W1e-01: 型不整合の改善と閉鎖範囲

`cache: { dir }` を有効cacheとして抽出し、cacheDirとの一致、snapshot配下の相対path、physical path、祖先link、file/directory種別を検査する修正は妥当。boolean trueの特例は旧合成fixtureに限定され、実測値をtrueへ改変して通す処理ではない。旧新版で異なるsnapshot絶対prefixのみを相対化する規則がコードに固定されている。Windowsのlive path/type/junction拒否も独立検証した。

ただしW1e identity単体は片側のsettingsを検査するため、両側の実測cachePair照合はW1f auditで確認する必要がある。実測auditのcacheConfiguration PASSは設定identityだけの判定。実効config全体とcacheの意味的安全性まで含む全面閉鎖は不可。**型不整合の修正は確認済み、実環境許可条件はPARTIAL。**

## P3-W1e-02: 原イベント結合の限界

run/trial/head/PID/preSeal、invoke/complete、operation/path、wall-clock window、PIDごとのmonotonic domain、原バイト/size/SHA、close状態を照合する実測JSONL結合器が追加された。未知operation、欠落、順序矛盾、close異常等がUNKNOWNになる対照を確認した。

observer自身のsaveState/inventoryによるreadがconsumer readへ数えられる問題を独立レビューで指摘した。修正はstack分類でevidence-samplerをobservedChain条件から除外している。再監査の旧新版は各909events / 454calls、rename候補各63件だが、consumer条件を満たすobservedChainは各0件。先行auditの63/63は消費主体を確認した証明として使用できない。stack分類自体もAPIの呼出元分類に限られ、意味的な消費の証明ではない。

Node公開API上のrename呼出しは観測できたが、atomic OS rename、native/worker/別processの操作、排他的writer、作成→rename→consumer read→削除の完全な来歴はUNKNOWN。OS全体のprocess不在は証明していない。**P3-W1e-02は閉鎖不可。**

## cache意味・実効config・admission

Vitest 4.1.11のResultsCacheとBaseSequencer.sortを独立に読取り確認した。保存IDはproject名＋相対file path、値はduration/failedで、既存cacheは次回に読み込まれる。failed優先・duration降順のschedulerに利用されるため、変動値を無害として除外できない。更新はpool.runTests後のupdateResults/writeToCacheに存在し、collectionだけの実測を実行cache意味の実環境証明へ変換できない。source-backed合成意味実験のPASSは、差分が実行順へ影響し得ることの確認でありcache許可のPASSではない。

実測のsettings、source、lock、初期dependencies、collection inventoryは同等とのauditを確認した。一方で正規化したfullConfigは不一致であり、serializationではclosure/native状態も証明できない。実効config全体UNKNOWN、cache安全条件NOT_ESTABLISHED、外部writer/lifecycle UNKNOWNを根拠に、hard stopは妥当。W1e/W1f gateには実比較spawn経路がなくNOT_READY固定。比較spawn旧0/新0、S4/S5 NOT_TESTEDを維持する。

## 回帰・既存P2・証拠対応

製品98files/2,587tests PASSの保存ログを読取り確認。既定探索は保全された.tmp-testsも収集し159files中9fail、2,688tests中2failと2errorsの原票があり、これを製品98filesの成功に混同してはならない。実装担当の他の回帰結果はその実施主体と範囲のまま扱う。

W1b runner/preflight/worker/summary、製品コード、package/lockに今回の変更を認めず、strict sealや既存P2の拒否条件を緩和していない。既存P2閉鎖を撤回する新しい反例は本レビューで確認していない。ただし独立レビューだけで過去の歴史的実行を再証明したとは扱わない。

`independent-reviewed-source.json` にレビュー時のworking-tree全W1fスクリプト、W1e契約、専用CIの原バイトSHA-256と開始HEAD/treeを保存した。これは最終commitの証明ではなく、commit後のGit blob照合・最終HEAD/tree・正式CI headShaの独立照合が別途必要。hash一致は保存時点のbytes整合性を示すだけで歴史的実行の真正性やOSの排他的主体を証明しない。最終commit/正式CI/証拠sealは本レビュー時点で未完了である。

## 結論

独立反例で見つけた再入障害と結合器の5つの偽PASSは修正・再検証済み。観測可能な範囲の改善は確認したが、P3-W1e-02、cache意味的安全、実効config全体、排他的主体とatomic OS操作は未成立。実比較開始、READY化、Draft解除、mergeを認めない。R8/H1～H4もUNKNOWN維持。

レビュー日時: 2026-11-16 21:20 JST。

## 追加再レビュー: cache実体の不存在 (21:23 JST)

実測cache directoryはS1/S2/S3/closeすべて不存在であることが追加判明した。上記のcacheConfiguration PASSという記述は設定照合の範囲に限定する。以前のphysical()が祖先のrealpathへ未生成suffixを結合した値は実在directoryの物理実体を証明しない。

修正版cacheIdentityは不存在時にphysical:null、projectedPhysical:prospective path、directoryState:absentを返す。cachePairはconfiguration:PASSでも全体PARTIAL、physical:UNKNOWNを返す。独立した通常ファイルシステム対照で、別root・同一relative suffixの不存在pairがPARTIALになること、実在directoryだけがrealpathとpresentを返すことを確認した。原票 `../stage-w1f-20261116/review-cache-physical/analysis.json`。最初の対照作成時に異なるrelative pathを渡してCACHE_PAIR_PATHとなったharness誤りも原票内に記録した。

不存在の実cacheに対して実体一致PASSを与えてはいけない。P3-W1e-01の型不整合修正の確認は維持するが、実体cacheの取得・旧新版の物理的独立性の成立はUNKNOWNのままであり、全面閉鎖不可。real-cache-checkのRED→GREENは同じWindows設定入力の型修正の検証だけで、directory実在やcache意味的同等性の証明ではない。

追加のevidence.mjsとreal-cache-check.mjsも読取りレビューした。前者のlossless gzipとGit blob/readbackはbytes整合性の検証、後者の旧契約実行copyは依存import URLだけを変更した再現であり、どちらも歴史的実行の真正性を証明しない。改訂後のsource sealは `independent-reviewed-source-physical.json` に別保存し、先行source sealは保持する。判定B/NOT_READY/比較0/Draft/mergeNOは変わらない。
