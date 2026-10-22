# PR #208 P2予算管理修正

レビュー対象/開始HEADは79babe1528e571b776b219e6d03417a1c772f58b、既存ブランチcodex/evasion-boundary-diagnostics。fetch/ff-only確認後も同じHEAD、作業ツリーclean。リポジトリ内AGENTS.mdはなく、ユーザー提供の回答末尾JST日時指示を適用。PR本文・現在差分・ローカル診断を確認した（GitHubには行コメント/レビューが未登録だったため、ユーザーのP2指摘を修正要件とした）。元checkout/mainおよび他worktreeは変更しない。

## 修正前の再現

before/reproduce.ts.txtをレビュー対象checkoutの.diagnostic-temp/reproduce-p2.tsとして実行。旧run1入力をコピーし、全体時間0ms・100,000 bytes・normal d1/extra0に縮小。参照探索が開始され、局所qが2件とも完走し、実ディレクトリは1,791,547 bytesになった。時間/容量の両不変条件はfalseだった。before/inventory.jsonに全出力の実bytes/hash、before配下に入力条件・局所比較・参照・旧manifest、validationに原ログを保持した。本修正のテストは同じ境界を制御時計/小容量/差し替え探索で検査する。

## P2-1：全探索が共有する停止期限

新規prepareのplanはformatVersion=2。RunDeadlineの単一期限を、matrix・qualityReference・局所q・ordinary・forcedの67タスクすべてに適用する。開始前に残りが1ms未満なら探索を開始しない。協調予算、子に渡す絶対期限、親の強制停止timeoutは個別上限と残り時間以内に切り詰め、各タスクの実際の割当てをstatusに記録する。同期の参照/合法手処理を含む全タスクを子プロセスで実行し、親側はSIGKILL上限を設定する。子の起動時間も期限に含め、期限後に届いた完走値は破棄してincompleteにする。製品の探索・ルールAPIは変更しない。

終了処理は、既に得た値のメタデータ集計、完全JSONの容量検査・保存、欠測理由・status・manifestの保存だけ。期限後の欠測生成でdiagnoseやapplyを呼ばず、参照・局所探索も追加しない。合法再生・内訳検証は別のauditコマンドで実施する。終了処理のOSファイルI/O/子プロセスの回収は探索期限そのものに含めた追加探索ではなく、所要時間の厳密な実時間保証はしない。停止期限が監督するのは新規探索の開始と実行である。

## P2-2：ディレクトリ全体の容量

40MiBを増額せず、測定出力ディレクトリ内の全通常ファイルを再帰的に実bytesで数える（symlinkは拒否）。prepare済みinput/planや予期しない既存ファイルも含む。ソース原本・環境・各タスクraw・参照・局所比較・summary・comparison・status・manifestのすべてを同じEvidenceStore経由で保存する。UTF-8バイト列を改行込みで先に作り、文字数ではなくBuffer.lengthを判定する。1ファイルを途中まで切り詰めず、容量不足なら全体を書かない。完全bytesを.pendingへ書いてrenameし、失敗時はその一時ファイルを除く。一時ファイルは最終ファイルへ置き換わるため二重保管しない。

40MiB内の256KiBを終了記録と最小manifest用に事前予約する。探索前に、既存ファイル＋必須sources/environment＋予約領域が収まること、全予定タスクの欠測状態/manifestが予約内に収まることを検査する。初期証拠が収まらなければ探索0回で明示的に失敗する。通常出力が容量不足なら後続探索を止め、予約内で未実施/欠測理由を記録する。statusの正常完了/time/capacity/exception/node/parent-timeoutは区別し、未保存の値はexactとして報告しない。ディスク障害やアクセス拒否で終了記録自体を書けない場合はプロセス失敗であり、完了扱いしない。

manifestは自分自身のbytesもtotalBytesへ含める（自己hashの循環は作らない）。auditは実ディレクトリ全ファイルとmanifestの名前・bytes/hash・合計・上限、予定タスクの状態と欠測理由、実際の割当て予算、派生集計を照合する。参照や局所比較が未完了ならcomparisonComplete=false、参照に基づく品質はInconclusive。完走matrixの有限exactと、全比較の完走は区別する。

## 旧形式と結論の保持

旧run1/ソースsnapshot/raw/manifest/検証ログは不変。旧planはaudit専用経路を維持し、新しい保証を遡及適用しない。旧トップmanifest中のREADME hashはレビュー対象当時の文書を指し、そのbytesをbefore/README-original.mdにも保持した。root READMEには修正への案内だけを追加する。旧run1の再監査方法は従来どおり：

```
npm run diagnose:evasion-boundary -- audit docs/benchmarks/evasion-boundary-20261022/run1
```

新規の予算保証は今回のv2だけ。新規prepare/run/auditも同じCLIを使用する。旧測定SHAは3dfebee2cfa4c9c72e519891538ef8e315e5bd28のまま、修正後の検証SHA・最終HEADは別に記録する。非捕獲成りのq追加は行わず、製品探索方針・評価・合法手・UI・Worker・保存形式・既定設定に差分なし。原因診断、勝敗unknown、ProvenError 0を変更しない。

検証結果と修正後の小規模CLI記録は追記する。マージ/自動マージ・新規PR作成は行わず、既存PR #208を更新する。
