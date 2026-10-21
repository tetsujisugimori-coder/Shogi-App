# 戦術品質診断（2026-10-22）

## 目的・事前固定

製品の探索を変更せず、戦術的選択の品質と `maxCheckEvasionExtensions=0/1/2` の効果を区別して測る。
基準main: `f9a78e255e7e0bfa53b3eed9a95b7fa3a143c1b4`。PR #202は2026-10-21T17:20:44Zに同SHAへMERGED。指定の実装SHAをmainとは扱っていない。
開始時mainはclean。既存worktree・診断原本は変更せず、最新origin/mainから `.worktrees/tactical-quality` / `codex/tactical-quality-diagnostics` を作成した。

PR #190/#202の14局面をすべて維持し、既存の合法な平手棋譜の続き2局面を追加する。収集規則は「最初の合法な駒取り、なければ最初の合法手」を2手。乱数・製品評価・測定結果を使用しない。13人工問題と3合法棋譜由来を区別し、完全state/持ち駒/history/positionHistory/snapshotsをplanへ保存。人工問題は欠けた駒を問題外とし平手到達可能性を主張しない。16局面の固定日時・入力hashはrun1/plan.json。予備と本測定で局面を追加・削除しない。

## 参照と分類

既存AND/ORの詰み限定証明をreferences.jsonに保存する。負の有限探索は不詰・安全の証明ではない。捕獲fixtureの座標条件も、品質の正解としない。

新しいquality-references.jsonは全合法手・全応手の通常3ply全幅探索。正順と逆順で各候補の値を照合する。各局面6,000ノード（両順合計）で停止し、部分結果を品質比較に使用しない。枝刈り、製品探索、q探索、SearchValue、TT、探索順序ヒントを使用しない。合法手生成・着手適用・終局規則・standard評価は製品と共有する。独立した将棋ルール実装でも外部USI評価でもない。

- ProvenError: 選択手とより良い合法代替手の全応手が終局まで閉じた場合のみ。root視点の勝敗・勝ち最短/負け最長を比較し、両候補と深さを保存する。有限深さの数値評価差を証明と呼ばない。
- QualityGap: 完全に走査した有限horizonで優る代替手がある。製品より深いとは限らない暫定参照であり、真の誤選択ではない。
- Inconclusive: 参照上限、未完走、fallback、欠測。詰み限定証明があっても全幅参照の不足を隠さない。
- NoObservedDifference: 指定した有限参照で選択手より良い手を観測しない。同値の別の良手も含む。真の最善・無欠陥を意味しない。

全widthの参照は再監査時に入力から再計算し保存値と完全比較する。閉じた終局木は合法着手適用が根拠。単一PVや公開Infinityだけで証明しない。AND/ORの詰み距離と全終局距離は混合しない。回帰の意図的ProvenErrorは分類器fixtureのみであり製品での発見数へ含めない。

## 実行・再現

Node 24 / npm 11。依存がなければnpm ci。Windowsのsandbox TEMP rename EPERM時はworkspace内のTEMP/TMPを指定する。既存テストのtimeoutやassertionは緩和しない。

```
npm run diagnose:tactical-quality -- prepare PILOT_DIR pilot
npm run diagnose:tactical-quality -- run PILOT_DIR
# 失敗時は audit-partial、完了時は audit
npm run diagnose:tactical-quality -- audit-partial PILOT_DIR
npm run diagnose:tactical-quality -- prepare NEW_DIR
npm run diagnose:tactical-quality -- select-cost NEW_DIR PILOT_DIR
# plan・参照を固定し、実装をcommitしてから
npm run diagnose:tactical-quality -- run NEW_DIR
npm run diagnose:tactical-quality -- audit NEW_DIR
npm run diagnose:tactical-quality -- audit NEW_DIR
```

既存check-evasion runnerのprocess分離・ローテーション・保存/監査構造を踏襲し、既存局面/参照/合法PV再生/partial-root検証を再利用。既存CLI・生データの意味は変更しない。
standard評価/standard順序、killer=false/PV=false/TT=false、q original+1、追加だけ0/1/2。固定d1/d4と100/1000ms（最大d4）。予備は同じ入力で各条件1回、予備の深さ4最大費用5,000ms以下かつ6標本完備の11局面だけを本測定の深さ4へ採用。他の3条件は16局面すべてを保持。本測定は固定各2回・時限各3回。各cellに別warmup1回。ABC/BCA/CABを回転して同一環境で直列に実行。参照、build、テストは計測中に並走しない。深さ5以上は実施しない。

sources.jsonに製品srcと診断ソースを保存しenvironment.jsonへ測定commit/元bytes SHA256/環境/入力・参照hashを保存。時限の通常/qノードは完了反復分、拡張統計は中断作業も含む。callMsは探索呼出しのみで、入力保護・PV監査・集計は時計の外。timeoutは親60秒hard-stop、例外/途中終了はfailure.jsonにcell情報を保存して停止。同期内部の合法手生成は協調的中断でありms期限の強制保証はない。

summary.jsonには入力/履歴識別・手番・由来・設定・合法性・評価内訳/PV・終局理由/距離・通常/q/追加ノード・call/API時間/超過・completedDepth/resultSource・参照候補と分類を保存する。raw.jsonlの再読込みで同一summary、条件/局面/カテゴリ集計と最初の選択手差を再生成する。固定反復は時刻以外完全一致を監査。時限の深さ差は正当性違反と数えない。p95は小標本の探索的観測で、一般的な速度改善や棋力の証拠ではない。

## 検証経過

初回関連テストはsandbox TEMP rename EPERMで起動失敗。workspace TEMPで実行後、追加テスト2件の期待値が正式API `completed-iteration` ではなく `completed` だったため失敗。テスト側の名称を訂正し、関連4ファイル72件成功。製品コード・既存assertion・timeoutは変更していない。初回全体check/最終検証はvalidationへ記録する。

実測結果と最終レビューはresults-report.md / review.mdを参照。


## 予備測定からの費用選定

予備測定は34a7d89a313d3747ad73a4a0546c9e8ca9b559a6。342呼出しを保存（warmup171・測定171）。hirate-followup-1 / d4 / extra0 / warmupで親60秒hard-stopが発生し、完了していない。failure.json・interrupted-audit.json・missing.jsonに失敗と42欠測cellを保存する（失敗cellを含む）。audit-partialは既知のcellの重複・不正値を拒否しつつ、未完了を明示して保存済み結果だけを再集計する。auditで完了扱いにはできない。

品質分類を集計する前に、費用のみで深さ4を11局面へ限定した。候補16局面は削除せず、深さ1/100ms/1000msは全局面を本測定する。select-costはraw/warmupのhash・最大費用・選定日時・旧planを保存し、測定開始後の変更を拒否する。最初から長い深さ5以上を試さず、最大費用9〜11秒の詰み2局面、約20秒の平手局面、60秒打切り/未実行の追加局面の深さ4を本測定しない。

予備後の診断コード修正は、途中監査、費用選定CLI、fallback内訳nullの検証、実際の制御時計partial/fallback回帰。製品・候補・参照・品質判定基準は変更しない。測定SHAは各environment.json。監査実行時の診断コードと測定原本のソースは区別し、sources.jsonを保持する。
