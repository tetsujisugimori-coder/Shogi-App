# 限定実測・検証結果

測定ソースは `22ced5869dfc618025ac736a2479ea2a52aa55f7`。製品コードはmain `0868d3e` と同一。今回の成果は診断機能の実装であり、製品の棋力や速度改善ではない。製品誤選択の新規確定は0件。人工履歴の分類器正例をこの件数へ含めない。

## 重点2局面

座標は0始まり(row,col)。各候補にdepth5/node6000/3000ms/1MBを独立配分。時間上限を安全停止として使用し、追加予算・都合のよい試行の選別をしない。証明の探索順は正順、キャッシュなし。今回の順序はmate-threeのwarmup1＋本3、evasionのwarmup1＋本3、その後に有限参照と候補別証明。参照・テスト・buildは実時間測定に並走していない。旧観測は#204/run1のextra0本測定だけを入力hashとともに読み、今回の測定と区別した。

Windows 10.0.26300 x64 / Intel Core i7-14650HX / Node v24.20.0 / npm 11.17.0。入力・source各ファイルSHA256・ソースSHA・設定・制限・測定順・時刻は[plan.json](run1/plan.json)。OS/JIT/GC/電源/温度は制御していない。製品設定はstandard評価/順序、q original+1、王手回避追加0、PV/TT/killer OFF。100msは最大d4であり、d4を早く完了したら100msまで待つ設定ではない。

|観測|局面・製品選択|本測定|完了深さ / resultSource|製品値|有限d3参照（選択 / 比較候補）|新証明（選択 / 比較候補）|品質分類|
|---|---|---:|---|---|---|---|---|
|今回|mate-three / 金(3,0)→(2,0)|3/3同手|4 / completed-iteration|+Infinity|+Infinity / 513（過去選択の玉(2,1)→(1,2)）|win / win、両再検証成功|NoObservedDifference 3|
|過去#204|mate-three / 玉(2,1)→(1,2)|3/3同手|2 / completed-iteration|504|513 / +Infinity（金(3,0)→(2,0)）|win / win、両再検証成功|旧QualityGap 3を維持|
|今回|evasion / 玉(8,4)→(8,3)|3/3同手|1 / fixed-depth|-1005|-1203 / -1005（玉(8,4)→(7,3)）|unknown / unknown、安全停止|QualityGap 3|
|過去#204|evasion / 玉(8,4)→(8,3)|2/2同手|1 / fixed-depth|-1005|-1203 / -1005（同上）|unknown / unknown、安全停止|旧QualityGap 2を維持|

mate-threeの過去の選択差は今回の100msでは再現しなかった。今回の実時間は本測定31.520 / 30.044 / 28.568ms、warmup40.297ms。旧100ms本測定は100.448 / 101.575 / 101.561msだった。実装・runner・JIT・観測時期等の異なる観測であり、速度改善の因果効果を主張しない。今回の3試行はすべてtimedOut=false、旧3試行は最後の正常完了反復後の次反復timeoutであり、completedDepth=0のpartial-rootではない。

evasion本測定は2.127 / 1.885 / 1.727ms、warmup1.999ms。旧本測定は11.850 / 10.897ms。こちらも速度比較の証拠とはしない。品質の有限差は再現したが、選択が真に負けるとも、代替が勝つとも証明できない。

|候補|新状態|探索node|停止回数|保存後再検証|結論|
|---|---|---:|---|---|---|
|mate-three 金(3,0)→(2,0)|proven-win|14|depth 9（証人以外の未完了枝）|成功、検証3node|必要証明は完成|
|mate-three 玉(2,1)→(1,2)|proven-win|8|depth 3（同上）|成功、検証5node|過去選択にも勝利あり|
|evasion 玉(8,4)→(8,3)|unknown|5337|depth 4481 / time 1|証明なし・検証合格を付与しない|必要枝が未完了|
|evasion 玉(8,4)→(7,3)|unknown|1224|depth 1033 / time 1|証明なし・検証合格を付与しない|必要枝が未完了|

前2候補は保存した葉がcheckmateで、記録された証人の長さは候補手込み3/5ply。ただし最短勝ち・最長抵抗を証明した距離ではなく、この長さで誤選択を確定しない。過去mate-threeの有限差を勝敗上の厳密な不利益へ昇格させる根拠はない。evasionは依然unknown。両局面のProvenErrorは0。

warmupも含む今回8観測、過去5観測は[summary.json](run1/summary.json)に分離保存。全候補の有限参照値、選択、完了深さ、resultSource、証明状態、制限理由、再検証結果を並べた。入力そのもの、停止枝のhash/手順・省略件数は[候補記録](run1/candidates.json)。重複候補は一度だけ証明し、各観測へ同じ入力・候補の結果を紐付ける。

## 保存後の再監査

```
npm run diagnose:outcome-proof -- audit docs/benchmarks/outcome-proof-20261022/run1
npm run verify:outcome-proof -- docs/benchmarks/outcome-proof-20261022/run1/proof-0.json 8faaa2a772c07ee890e836d93daed95bbe17e72613a7ccc8995ff2812ae53272
npm run verify:outcome-proof -- docs/benchmarks/outcome-proof-20261022/run1/proof-1.json 747ec5643104f00e7b89a89e8ea6b952cf04f7e014c7faa3129bc8bc001850f0
```

auditを保存後2回実行し、両回valid=true、13行/4候補/2証明、再生成summary hash `58b50b5df3239ebdee70ce2b44e03a14bea821b58c8aa84f2f7d08cecd4f1289` が一致。各証明のCLIも終了0で成功。unknownの2候補に証明ファイルはない。旧tactical-qualityディレクトリ全80追跡ファイル（旧raw/warmup/環境/source/原本manifest/v2/v3/レビュー修正を含む）のSHA256は前後一致し、上書きしていない。新入力・新観測・source識別・設定・証明・再集計の対応はplan/manifestで固定する。最終HEADは測定SHAの子孫で、測定後は記録文書・証拠だけを追加する。

## 検証の成功・失敗・未検証

- 新規35件成功。先後のwin/loss、quiet初手/非王手応手、複数応手の全称条件と最後の枝の中断、代替win＋選択unknown、実際の終局再生を伴う人工loss＋win正例、両方win、partial-root/fallback/完了反復後timeoutを確認。
- 深さ/node/時間/記録/中断/例外、no_legal_actions、実際の合法cycleによる千日手・連続王手、500手王手待機、欠落/重複/不正手/勝者/理由/非終局葉/手番/履歴/視点/参照/循環の改変拒否、検証予算、保存後再検証、CLI終了0/1/2、入力非破壊・再現性を確認。別の全幅区間値探索（horizonを[-1,+1]とし全枝を配列へ集めてmin/max）と、正順/逆順証明を小局面で照合。
- 初回sandbox TEMP rename EPERMではテストを開始できず、workspace TEMPで実行。最初のcheckは新しい改変fixtureの型エラーで停止し修正した。rootからのcheckは既存worktreeのテスト収集を確認して中断し、途中の既存UI timeoutを保持。隔離worktreeへ移し標準checkを実施した。
- 隔離の全体checkは83ファイル/2187件中2185成功、既存2件timeoutで失敗（minimaxの深さ3途中詰み5.155秒、quiescence-ordering-repeatedのsnapshot mock 6.535秒、上限はいずれも5秒）。この時点の新規34件は成功。追加補強後の関連7ファイル188件は新規35件を含め187成功/同既存snapshot 1件timeout（6.851秒）。その前の関連実行は新規の停止記録サンプル検査1件だけ失敗し、最初の8件がdepthで埋まる場合に最終node停止位置を残すよう修正した（勝敗の判定条件は不変）。既存の2ファイルはその実行で成功。snapshot単独再実行は37件すべて成功、1.54秒。全体成功と表記しない。
- lockfile検査、最終TypeScript/lint、build（1761 modules）、git diff --check成功。既存テスト・timeout・assertionは変更していない。製品ディレクトリとpackage-lockに差分なし。実行ログの元bytesを復元できるgzipとhashはvalidationへ保存。
- CIは最終HEADで確認してPR本文と最終回答へ報告する。ローカル全体テストの失敗をCI成功と混ぜない。macOS固有fseventsはローカルWindowsでは未検証、CIへ委ねる。

## 別観点の自己レビューと次の一手

自己レビューで、root視点固定、負け側の存在/全称反転、全合法手と全称枝の多重集合一致、unknown非昇格、履歴tail不一致の拒否と完全履歴の再生、実際の理由/勝者の照合、勝利と詰みの区別、最適距離を分類しないこと、partial-rootを先にInconclusiveとすることを確認した。これは第三者レビューではない。

残る制約は共有ルールの誤りを独立に見つけられないこと、人工入力の到達可能性を証明しないこと、引分混在木は保守的にunknownとすること、既終局の宣言/千日手入力は直前状態からの再生が必要なこと、同期API内部を強制停止できないこと。今回の少数測定から一般棋力・安定性能を推定しない。

次は、この診断を使ってevasion後の反撃とhorizonの違いを局面ごとに調べる。製品改善候補はその証拠を得てから限定的な回避拡張等を比較する。現在は王手回避/PV/TT等の既定OFFを維持し、予算を際限なく増やさない。
