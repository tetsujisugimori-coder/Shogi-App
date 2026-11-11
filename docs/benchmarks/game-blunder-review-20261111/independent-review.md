# 独立レビュー

## 判定

総合判定はPARTIAL、マージ推奨はNO。P2-01、P2-02、P3-01はPASSとして閉鎖可能。固定ソースに対する新規未解決指摘は0件。Windows既定5秒の全体実行が安定せず、R8の原因はUNKNOWNのまま残る。

レビュー対象の実装HEADは1edc169cc9ff27b7c77e825e95b893e5b0252ed1。正式な独自反例実行の開始時・終了時HEADはこのSHAと一致し、tracked差分は空だった。

実装ファイルは編集していない。独自ハーネス、入力、判定、原本照合を作業repo外で作成・実行した。静的レビューで発見した不足を実装担当へ伝え、担当が修正した後の固定ソースを検証した。

## 読み取った契約と証拠

Issue #217、Draft PR #218、指定レビュー5783718333の全文、基準HEAD e1ccb1a2412e7faa86c2c1f60fdad1dca154023a、全実装差分、既存テスト、正式な実験planとsummary、RED→GREEN、Windowsの成功・失敗ログ、旧原本hashとsource provenanceを照合した。

最終提出HEADのCIは、このレポート作成時点で未確認。提出HEADのコード同一性とCIは後続追補で照合する。基準HEADのUbuntu/macOS CI成功記録は保存済み証拠で確認した。

## 指摘別の閉鎖

### P2-01

PASS。repeatKeyとは独立して、選択ID、journal復元位置、実行時hash、mode、条件全体、予算、rep、候補制限、合法PVを照合する。schema 3の必須identity欠落を拒否し、旧schema 2はjournal-reconstructedと明示する。候補の合法応手・捕獲・取り返し・交換枝も再構築して照合する。

正式RED→GREENでは、別hash・別mode・別設定・別深さ・planを含む別予算・候補応手改変の6件が、旧版の誤受理から新版の保護へ変わった。別予算の単独改変、重複rep、欠落rep、別IDは旧版でも拒否していた8既存保護ケースの一部として区別されている。

独自反例ではschema 3のpositionHash、mode、condition、budgetを個別に削除した4件、schema降格1件、候補の応手・捕獲記録改変1件を実際の終了コード1で拒否した。

### P2-02

PASS。baselineのdepth 2、q depth 1、standard orderingと全不変項目を固定の条件契約へ照合し、q0、depth1、see-orderの名前・設定を検証している。

正式RED→GREENの4件すべてで旧誤受理を実証し、新版は拒否した。q0を別の一項目変更へすり替え、depth1の名称を変更し、SEEの値を変更し、全条件のTTを同時に変更するケースを確認した。SEEは既存policyの比較として扱われ、純粋なSEE算術の証明へ格上げしていない。

### P3-01

PASS。finite-completed、有限score、完了深さ、結果カウンタ、候補とPV、PVの探索深さと静止探索手種、実際のPV葉での全評価内訳を検査する。無効結果は原因・ID・条件・rep・件数を保存し、正式なscoreと有限差から除外する。

正式RED→GREENでは、null、NaNタグ、Infinityタグ、JSON数値Infinity、無効validity、偽の有限値、評価内訳不一致、node不一致、負の統計、非有限時間、違法PVの11件が旧誤受理から新版の保護へ変わった。partial、interrupted、error、深さ不一致の4件は旧版でも保護されていたことを確認した。

独自反例では、有限値とtotalの同時改変、構成要素も含む同時改変、通常/q nodeの同時改変、負・非有限の統計、合法captureだけで探索上限を超えるPV、合法だが非王手時の静かなq手を実測した。8件すべてで対象の2観測が原因付きで除外され、再現成功数は24から23へ下がった。集計プロセスの終了コードは0で、異常値を有限評価として使用していないことを結果JSONで確認した。

## 独自反例の正式結果

results-1edc169-v2/results.jsonに正常対照1件と負対照14件を保存した。正常対照はroot24/24、無効0、候補比較16条件すべてで両候補の反復が有効だった。負対照はすべて拒否または対象2観測の除外となった。

results-1edc169は追試前の探索的な結果。そこでのoverlong PVは静かなq手との複合違反で除外された。正式v2では合法captureの連続だけで3手PVを作り、pv-exceeds-search-horizonを単独で確認した。元の入力と結果は保持した。

全入力JSONL、変更内容、SHA-256、実際の終了コード、除外原因、ソースhash、HEAD、TEMP、cache、所要時間を保存した。independent.mjsとCOMMANDS.ps1で再計算できる。verify-results.mjsは正常1件、構造拒否6件、原因を固定した除外8件をassertし、終了コード0で成功した。

## 原本・source・正常集計

audit.pyを独立に実行した。旧tracked証拠44件と4 journalの48件は、開始時manifest・終了時manifest・現在のbytesが全一致した。新実験の99 sourceは記録raw hashと実装HEADのcanonical LF blobへ全件一致した。旧4 source snapshotも基準HEAD blobと一致した。

開始時manifestから漏れていた11生ログは、基準HEADに保存されたgzip blobを独立に取得・展開し、現在の生ログと11/11でbyte一致した。開始時にhashを採っていなかった範囲はこの事後照合と区別している。

旧正常データの再集計は、追加された出所と無効結果メタデータを除いて旧summaryと同値だった。56候補のA/B/C/D/E/Fは21/1/3/1/0/11、重複11、特徴なし30 UNKNOWN、INDETERMINATE24 / NOT_RUN32を維持した。

新schema 3はroot24組と候補64呼出しの32反復組が有効、無効0。旧疑い4局面はINDETERMINATE、CONFIRMEDは0、改善優先順位はNOT_READYを維持した。

製品domain/type、package/lock、Vite設定、CI workflowの基準HEADからの差分は空だった。

## Windows検証と残件

旧失敗2テストの特定と、基準HEADでの単独・並列5秒・並列15秒の反復を確認した。対象2件の単独実行では旧timeoutを再現していない。

4d626a4のsandbox内全体5秒は15失敗と12失敗。15秒は2586成功だった。1edc169のsandbox外5秒は1回目に14失敗とunhandled AbortError 1件、2回目に2587成功。1回目の14件はrunner-timeout12件と要素検索失敗2件に分けて保存されている。同HEADの15秒は2587成功だった。

型検査・build・lockの成功ログを確認した。Windowsの全体5秒失敗は残っており、15秒成功を解消と判定していない。低い空きRAMの観測だけで原因を断定していない。製品探索の時間上限とテストランナー上限は別に記録されている。

R8はPARTIAL、時間切れ・UI連鎖失敗の根本原因はUNKNOWN。次の最小実験は、同一資源条件で旧・新HEADの全体5秒を交互に反復し、各workerのCPU・memory・GC・テスト開始終了・timeout後のUI cleanupを同時記録して、追加テスト負荷と環境要因を切り分けること。

2026年11月11日 12:39 JST
