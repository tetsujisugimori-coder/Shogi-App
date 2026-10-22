# evasionの応手と探索境界の診断

基準mainは `40b811dbaf685cd7fc86a3ef3a1defc5dadf14f0`。PR #206は2026-10-22 16:49:30 JSTに同SHAでマージ済み。開始時mainはclean、fetch後もorigin/mainと一致しfast-forward更新不要。Git管理領域の書込制限には通常の昇格を使用した。元checkoutをmainへ戻し、許可済みvisualizations領域の隔離worktreeに `codex/evasion-boundary-diagnostics` を配置した。既存worktreeは変更しない。リポジトリ内AGENTS.mdはなく、依頼文の「回答末尾に日時」を適用する。関連PR #202/#204/#206の本文・レビュー・行コメントはcontextに保存した。

## 入力・再利用

`run1/input.json` は#206の保存済みplanから取得し、#204の完全状態とhash一致、#206の候補証明requestの完全状態/履歴と一致、保存済みunknown 2件を確認した。問題文の座標から盤面を再構成していない。元入力のhistoryは0件、positionHistory/positionSnapshotsを含む人工問題で、平手からの実戦到達可能性は未確認。候補の適用後も元の履歴を保持する。元局面のIDはevasionのままで簡略化しない。

既存の合法手生成・apply・observePv・loadPositions・qualityReference・qualityClassify、独立全幅evasionReferenceを使用する。勝敗証明基盤・v3分類器・証明契約は変更しない。有限値の差はQualityGapまで、両候補の勝敗は今回も新たに証明せずunknownを維持する。

## 診断方式

既存SearchDiagnosticsに既定無効のtraceNodeと、fixed APIだけで働く合法rootAction指定を追加した。rootActionは元状態の合法手集合から1手だけ選ぶ観測用指定。元rootの手番・深さ・ply=1・評価視点・SearchValue・完全履歴を保ったまま既存再帰へ入る。候補の事前適用後に同じ深さを再指定することによる1手のずれを避ける。探索方針、評価重み、ルール、UI、Worker、保存形式、製品設定は不変。PV/TT/killer、王手回避追加の既定OFFを維持する。

通常/qの進入・返却・境界/枝刈り理由と残り予算をフックで観測する。traceは完全手順・状態hash・手番・王手・持駒・直前の捕獲・root視点の静的評価内訳を持ち、保存後に元入力から合法再生する。内訳は既存4項目だけ。内部ノードのstaticBreakdownは診断側が計算した静的値であり、探索の返却値valueとは別である。PVには各手の合法性・捕獲・成り・持駒・履歴長・残りnormal/q/evasionを記録する。PVのleafReasonは予算と合法再生から再構成した境界の説明で、全木の実際のstop/cutoffイベント件数とは区別する。

元rootの各候補の返却窓とexact/upper/lowerを保存する。窓端の等値をexactの同点としない。全4合法候補は別の公開fixed呼出しで全窓評価する。完了すれば、その有限normal+q+evasion仕様に対してexactである。静的なhorizon/evasion上限の近似をゲームの真値や勝敗証明にしない。全候補の完了時だけSearchValueで順位を付け、同点を元の合法生成順に並べ、元rootの選択と照合する。生の候補値を枝刈り順に順位付けしない。

## 本測定前の固定予算

plan.jsonは本測定開始前に保存。normal d1/2/3/4 × extra0/1/2 × 元root+全4候補の60呼出しを直列実行。standard評価/順序、q original+1、PV/TT/killer OFF。各呼出し50,000進入（normal/qは別進入として数える）、10,000ms協調停止、12,000msの親プロセス停止、trace1000件/524,288 bytes。trace記録上限は探索を止めず省略件数を保存する。全体300,000ms、記録40MiB、予算不足cellは未完了/欠測とし増額しない。同期ルールAPI内の強制停止は親プロセスに依存する。時間値は計測フック・hash/内訳計算を含む診断時間で製品性能ではない。

予備はpilot-planとpilotに分離。予備の元root4呼出しで実行可能性を確認した後、同点確認のため本測定の全4候補を固定し、記録予算を40MiBに確定した。本測定中に結果を見て予算を変更しない。予備は未commitソースであり、本測定の結果・性能へ合算しない。

本測定後、既存qualityReferenceのd3/node6000（正逆両順、qなし、全合法手、標準静的評価、全枝終局closedを区別）を実行する。製品は同じnormal d3でもq1があるため参照と探索範囲が異なる。予算内の対象候補について、元rootから1手後の局面で、静的評価、q1、normal1+q1、保存済み有限参照の応手を固定したnormal1+q1を比較する。局所APIの相手視点評価を元root視点へ変換し、PVは元rootのply=1から表示する。これは限定的な因果切り分けで、単一PVを全応手の保証にしない。

## 再現と保存後監査

```
npm run diagnose:evasion-boundary -- prepare NEW_DIR
# 実装をcommitしてから（既存dirへのrunは再測定上書きを拒否）
npm run diagnose:evasion-boundary -- run NEW_DIR
npm run diagnose:evasion-boundary -- audit NEW_DIR
```

実行SHA、全製品/診断ソースの原本とhash、入力hash、旧証拠全ファイルのhash、環境を保存する。各rawは独立したファイルで、途中の子プロセス停止にも完走値を捏造しない。auditはmanifest対象のbytes、全予定cell、全PVと保存traceの合法再生・root視点内訳・持駒・ply・容量、保存参照による既存v3分類を確認し、rawからsummaryとcomparisonを再生成して比較する。旧原本を上書きしない。hashは署名ではなく、manifestと原本の両方を改変した攻撃の防御ではない。

結果・検証・自己レビューは [results.md](results.md) に記録する。
