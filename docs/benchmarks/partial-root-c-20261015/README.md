# 深さ1未完走時の製品C方式

開始main: cc37291a121a9bf72cef222ff472e5d2f1e90f45（2026-10-15 JST、origin fetch成功）。元mainはclean、既存worktree/関連PRを確認。専用branch feat/partial-root-c と独立baselineを作成。他checkout・既存診断原本を変更しない。

読了した根拠: PR #184 / docs/benchmarks/fallback-quality-20261014/README.md、前回ローカル成果 2026-10-14/1-root-c-c/outputs/c-diagnostic/report.txt、manifest.json、diagnostic-only.patch。zipも同じoutputsに存在。候補別診断にはcommit/PRなし（reportに明記）。55回改善は診断ONの仮想選択で、製品Cの今回測定に流用しない。

## 影響範囲・合格条件（測定前に定義）

探索結果型、深さ1候補の保持、Worker受信検証、同一時間比較、研究画面/判断パネル、自対局/benchmarkのsource検証。評価関数・SEE・静止探索・合法手生成・探索順序・既存時計箇所は変更しない。固定深さの結果は時間以外の全フィールド一致。制御時計で0候補/1候補/複数候補/後続中断/返却後棄却/bound/NaN/Infinity/同点/先後/完了反復優先/入力不変/例外を確認。Worker handlerからstructuredClone/UI表示・適用・中止を実行で確認。v1棋譜保存・復元と既存互換テストを実行。

時間ゲート: 100/1000ms・10局面・warmup2+測定5、順序交替。pooled p50/p95でC−mainが max(5ms, 予算1%) 以下を目安とし、最大超過と局面別深さの差も確認。OS/JIT/GCを固定していないため個別揺れから速度改善を断定しない。品質ゲート: partialの評価が同じ候補の独立無限窓q1評価と一致し、元先頭手以上。10個の異なる局面であり、同一局面の反復を独立局面に数えない。

## 結果契約・期限

優先順は終局済み/合法手なし → 最深完了反復 → 深さ1で期限内確定したexact最善候補 → 従来先頭合法手。

partial-rootはdepth=completedDepth=0、timedOut=true、iterations=[]。selectedEvaluationはroot手番側のexact値、内訳とPVは同じ候補探索の末端。PVを再生成せず、期限後に評価しない。候補の正常返却だけでは確定しない。

診断patchの追加時計/全候補hookは移植しない。候補返却をpendingとして保持し、次の既存deadline確認成功後にcommitする。通常は次候補の開始前チェック、最後の候補は反復終了チェック。now >= deadlineは棄却。追加時計は0、deadline箇所と探索順序はmainと同じ。最終反復チェックで期限に達した場合、最後の候補は不採用、以前にcommit済みの候補を返す。この方式ではN/N commitなら同じチェックで反復も完了し、診断ONの追加チェックで作れたN/N未完走ケースは製品OFFでは発生しない。

深さ1のstatic/終局子はunprunedなのでexact。q使用時はroot窓[alpha,+Infinity]で、無限窓/alphaを上回る値/絶対端点±Infinityだけをexactとする。有限fail-low/equalityはupperとして除外。有限lowerはこの窓では生じない。NaNや内訳totalとの不一致は除外。Infinity・null・未取得を区別し架空の値で補わない。同点は元root合法手indexが小さい候補（深さ1は元の合法手順）。

保持はcall内のbestと期限承認待ちpendingだけ。両者が必要なのはpendingの期限不通過でも前のbestを維持するため。全候補配列・module-global hook・追加時計は導入しない。

## 統計

通常統計は最深完了反復、total系は完了iterationsの合計。partial-rootでは全て0。この0は未探索を意味しない。partialRoot.completedRootCandidateCountは期限確認済み候補数（boundを含む）、exactRootCandidateCountはそのうちexact件数。selectedRootOriginalIndexは採用手の元合法手index。

partialRoot.attemptedStatisticsは未完走の深さ1の既存カウンタのsnapshot。通常visitedは生成した子（中断候補を含む）、quiescenceLeafCountは開始したq呼出し、q visited/cutoff/skippedは正常返却したq呼出し分を数える。**中断中q内部の未返却作業量は取得できず含まれない**。実作業全量や採用候補単独の統計として扱わない。採用候補の統計は新たに公開しない。elapsedは従来どおりroot生成と未完反復を含む。既存totalへ部分量を足さない。

## Worker・UI・保存

Worker共有型はdomain型を参照し、handlerは結果をそのまま転送。structuredCloneで数値Infinityを保持する。新sourceはclient/研究画面/比較受信でcandidate metadata・評価・内訳・合法PVを検証する。取消generation/signal判定は従来経路を維持。

表示は「部分探索・深さ1未完了」「選択候補の評価・PV」「全合法手の比較は未完了」。深さ1完走や全候補の最善評価とは表示しない。完了反復統計のラベルも明示する。

v1棋譜/研究sessionは合法着手と局面・履歴を保存し、探索結果自体を保存しない。保存形式/バージョンを変更しない。partial着手後の保存復元を検証し、旧棋譜・sessionテストを維持する。自対局記録はsource・評価・PVに加えて任意partialRootを保存する（旧データで欠落可）。benchmarkの既存非有限値文字列表現（Infinity/-Infinity）を維持。今回測定rawは+Infinity/-Infinityとnullを区別する。自対局JSONに専用復元APIはなく、棋譜復元APIと混同しない。

## 再現

baselineを上記SHAで別checkoutし、両方npm ci。製品checkoutで:

```
node --import tsx scripts/measure-partial-root.ts <baseline absolute dir> <new output dir>
npm run check
```

測定中はテスト/build/別測定を並走しない。出力先は新規のみ。環境・SHA・dirty diff・順序・入力hash・raw・quality・fixed・summary・終了markerを保存。独立品質評価と固定深さ比較は全時間測定の後。

測定・検証の実績は完了後に追記する。浅い評価の改善を勝率や真の棋力改善と断定しない。

## ローカル検証の基準比較

標準npm run checkはWindowsで全体テストのtimeoutにより停止した。1回目は1,927中2失敗（既存反復測定timeoutと、新規保存テストのfalse/undefined正規化差）。保存テストは生オブジェクト比較をv1保存結果全体の一致へ修正した。2回目は1,929中1失敗（既存プリセット比較UIの5秒timeout）。timeout/assertionの許容値は変更していない。

同一基準mainのnpm run checkも1,910中1失敗（同じ既存反復測定テストが5秒timeout、実時間6.192秒）。製品側で発生したプリセットUI timeoutはこのmain実行では再現しておらず、別の失敗として記録する。mainのGitHub CIはsuccess（run 38542104494）。全体失敗を個別成功で置き換えない。製品全テストの並列1実行と別buildの実績は完了後に追記する。

mainはprotected=false、required_status_checks APIは「Branch not protected」404。今回の確認対象はリポジトリ標準CIのVerify on ubuntu-latest / macos-latest（lock、型、全テスト、build、macOS固有check）。公開後に最終head SHAと照合する。

前回診断zip SHA256: a3360e433ece30e2d361e8541011d9cc2d12da1ba87cbcd589a22148240d2e3c0。zip内report.txtは展開原本とバイト一致（SHA256 8dbb021576b81b768d29fe039fdc41e63b5b1033306abaf5afdd4463b3dfbbd7）。

製品最終コードのローカル全体検証（並列1）は71ファイル/1,932テスト中1,931成功・1既存timeout（反復測定、6.880秒）。新規/変更対象の22追加テストを含め、assertion失敗は0。lock検証・型検査成功、別実行のbuild成功（18.31秒）。標準全体checkの失敗を個別成功で置き換えたものではない。timeoutを緩めていない。GitHub標準2OS CIを確認するまでは必須チェック成功とは主張しない。
