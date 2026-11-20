# 最終HEADの独立レビュー追補

07db466b6f11558c9eb257a49c21f1dd6f3a4753時点の事実を追記する。既存REVIEW.md、v1/v2入力・結果、41ファイルのarchiveは保持した。

## 判定

総合PARTIAL、マージ推奨NO。P2-01、P2-02、P3-01はPASSとして閉鎖可能。新規未解決指摘は0件。Windows既定5秒の全体試行の失敗が残り、R8はPARTIAL、原因はUNKNOWNを維持する。

## 最終コードと証拠

実装HEAD 1edc169からの85変更は全て新証拠ディレクトリ内だった。scripts、src、package、lock、config、workflowのコミット差分と作業差分は空だった。source99件のraw hash、旧原本48件のSHA、archive内41ファイルと全保存bytes、evidence-manifestの88ファイル、readable3コピーのbyte一致を独立に再検証した。

archive SHA-256はda2281b44b1f6638db605b457ac0b3eac3f68318219071799a29fe3997b626e7。

## GitHubの直接照会

独立担当がghで最終CI JSON・raw log・PR状態を直接取得した。CIのheadShaは07db466に一致し、completed/successだった。Ubuntuは98 suite・2587成功、macOSは98 suite・2585成功・既存2 skipped。両jobの型検査、lock検証、全体テスト、buildは全て成功だった。skippedを成功件数へ含めていない。

PR #218はOPEN・Draft、mergedAtとautoMergeRequestはnullだった。[GitHubのCI実行](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/42954635780)

取得した一次記録はci-direct.json、ci-direct.log、pr-direct.json。実装担当が保存したCIのHEADと結果も直接照会結果へ一致した。

## pair-fixedのNaN追試

新schema3のhirate-1 / ply9 / baseline actualのrep0とrep1だけを、NaNタグのselectedEvaluationとtotalへ改変し、repeatKeyを再計算した。実プロセス終了コードは0。

該当条件はreproducible=false、正式deltaと両候補の表示scoreはnullとなった。対象pair-fixedの2観測がnon-finite-evaluationで原因付き除外され、root24/24は有効のままだった。該当groupの各要因比較はEXPERIMENT_INVALID、deltaChangeはnullだった。

元の実験原本と既存v2は編集していない。pair-nan-followup.mjs、pair-nan-followup/input.jsonl・summary.json・result.json、pair-nan-followup.log、pair-nan-followup-exit.jsonで追試を再計算できる。入力SHA-256はaab6cf0f72ba1ce1058cfcad35c4eeff69a6293f0aa6fa10a0963f834d3f26f0。

旧疑い4局面のINDETERMINATE、CONFIRMED=0、改善優先順位NOT_READYを維持する。

2026年11月11日 12:51 JST
