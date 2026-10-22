# 限定AND/OR勝敗証明

PR #204を取り込んだ最新origin/main `0868d3e4da9a837f0b99befe031e1d33b23073ac` から専用ブランチ `codex/bounded-outcome-proof` を作成。開始時mainはclean、origin/mainと一致し更新不要。既存worktree一覧を確認し変更しない。リポジトリ内AGENTS.mdは存在せず、依頼で渡された「回答末尾に日時」を適用する。#204本文・レビュー・行コメントと解決記録、README/LOG、旧設計/原本/v3/レビュー修正を確認した。

## 意味と制限

視点は開始時root側で固定する。proven-win / proven-loss / proven-draw / unknownを分離。root手番の勝ちは存在、相手手番の勝ちは全称。負けは逆。引分は実終局または全合法枝が引分になる場合だけ証明する保守的な方式で、引分を勝敗へ丸めない。勝敗/引分が混在してこの条件で証明できない場合はunknown。

候補手指定時は開始状態からその合法手を適用した残りのゲームを証明する。候補手は深さの1plyに含める。未指定なら開始状態のゲームを証明する。全合法手を使用し、王手限定・評価値・Infinity・PV・製品探索・q探索・SearchValue・TTを使わない。キャッシュなし、履歴を保持して毎回着手する。

終局は製品の合法手生成、executeLegalAction、adjudicateNoLegalActionsを利用する。王手でない合法手0も敗北だがcheckmateではない。四回の千日手、連続王手の反則負け、500手到達時の王手継続待機は履歴/待機状態をそのまま製品APIへ渡す。盤面再出現だけで終局にしない。開始状態の履歴tail不一致は拒否し、暗黙のnormalizeによる履歴破棄を防ぐ。

開始時からendedの場合はno-legal判定が結果全体を再現できる場合だけ受け付ける。他の既終局入力（投了/宣言/既に終わった千日手等）はunknown/errorか入力検証エラーとし、勝敗へ変換しない。これらを扱う場合は終局直前状態と候補手を渡す。完全な開始状態の履歴は保存・hash固定するが、人工問題の平手到達可能性や入力前の歴史の真実性は証明しない。ルール実装を共有するため、その誤りを独立に検証する仕組みではない。

深さ/ノード/時間/記録量/明示中断/例外では必要な証明が未完了ならunknown。深さで未完了になった無関係な枝の後、必要な存在証人を得た場合はproof-completeとなり、先のdepth停止回数も残る。ノードはvisit進入数（候補の適用を除く）、停止試行自体は加算しない。時間は協調確認であり同期ルール処理の強制中断ではない。距離最適性は証明せず、手順の長さを誤選択の分類に使用しない。勝利と詰みを混同しない。

## 証明形式v1と再検証

Certificateはversion=1、完全Request、requestHash、outcome、入れ子のProofNodeを持つ。Requestは完全BoardState（history/positionHistory/positionSnapshots/500手待機等）、候補手、固定視点、設定/order/制限、実装SHAとソースhash集合の識別情報を保存。ProofNodeは状態hash、手番、outcome、terminal/exists/all、全合法手識別情報、必要な枝、実際の終局結果（理由・勝者・敗者・反則理由等）を持つ。単一PVを全応手証明にしない。外部node参照を持たず、未知フィールド、循環、共有node、不正参照を拒否する。

ファイル上限4MiB、呼出側はそれ以下を指定。探索中はノードの保持量を保守的に累計し、保存前に全体の実bytesも検査する。省略された不完全な木はCertificateにしない。unknown結果は証明ファイルを持たず、nodes/stops/error/finishedを候補記録に残す。捨てた枝も累計記録予算に含むため、最終木より早くrecord停止する場合がある。

別モジュールverifyOutcomeProofは探索成功フラグに依存せず開始状態から再生する。全称枝は再生成した全合法手と多重集合を比較（欠落・重複・不正を拒否）、存在枝は1証人だけ許す。手番・視点・状態hash/履歴・理由/勝者を照合、非終局葉を拒否。検証にも100,000node/10秒/4MiBの独立上限があり、未完了は不合格。JSON読込前にもCLIで4MiBを検査する。証明書内のhash自身を信頼点にせず、観測/manifestから取得したRequestのSHA256を渡す必要がある。hashは真正性署名ではなく、証明と信頼側manifestの両方を書き換えた攻撃を防ぐものではない。

```
npm run verify:outcome-proof -- PROOF.json TRUSTED_REQUEST_SHA256
npm run diagnose:outcome-proof -- run NEW_DIR
npm run diagnose:outcome-proof -- audit DIR
```

再検証CLIはstdoutに機械可読JSON、stderrに人向け要約。終了コード0=全必要枝検証済、1=証明不正/検証未完了、2=使い方/読込失敗。runは新規dirのみ、auditはread-onlyで保存ファイルhashと旧原本hashを確認し、保存後の証明再検証と分類再集計の一致を確認する。summaryは派生物として再集計比較し、その元入力はmanifestで固定する。

## v3との接続

qualityClassifyは変更しない。classifyWithProofsは既存v3判定を先に計算する。partial-root（評価あり/深さ0含む）、fallback、評価なし、未完了参照は従来どおりInconclusive。正常completed-iterationの次反復timeoutは正常完了結果を維持する。候補の証明自体は別欄へ残す。

追加のProvenError条件は、同一入力/固定root視点で選択手proven-loss・別の合法候補proven-winの両証明が保存後再検証に合格した場合のみ。これは厳密な勝敗不利益であり距離比較ではない。選択手unknown＋代替win、両方win、有限値差は追加条件に該当しない。従来の両候補all-terminal方式の独立した証拠はそのまま有効。旧原本/旧v2/v3を書き換えず新観測と旧観測の再評価を分離する。

## 事前固定した限定実測

対象はmate-three/100ms（最大d4）とevasion/fixed d1。既定設定相当のextra0、PV/TT/killer OFF、standard評価/順序、q original+1。各局面warmup1＋本測定3、mate-three→evasionの直列順、測定後に参照/証明を実施し、テスト/buildを並走させない。OS/JIT/GC/電源等は固定しない。

対象候補は新しい全選択手、旧extra0観測の全選択手、旧保存d3参照の最良候補（同値なら元順序）を局面ごとに重複排除。各候補へ独立に深さ5/node6000/安全停止3000ms/1MBを割当て、予算を増やさない。正順/逆順は小局面回帰で照合。旧100ms観測を今回の製品選択として報告しない。

結果と標準検証・自己レビューの記録はresults.mdへ追記する。人工履歴分類器の正例は製品の誤選択件数と分離する。
