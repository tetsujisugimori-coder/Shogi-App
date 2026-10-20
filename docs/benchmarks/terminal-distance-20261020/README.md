# 終局距離を使う内部比較（2026-10-20）

基準mainは`6cd961b699a9985a0ff73ca6a93bb7bbdaa2b2ef`。origin/mainをfetchし、PR #190が同SHAにマージ済みであること、本文・レビュー・診断結果を確認した。開始checkoutはclean。既存worktree一覧と添付一覧を確認し、既存worktree・保存済み診断原本は変更しない。専用ブランチは`codex/terminal-distance`。README/LOG、tactical-mate-20261019、partial-root-c/partial-root-matches/fallback-quality、探索・合法手・終局・Worker/UI/保存テストを参照した。追加AGENTS.mdなし。回答末尾に日時を付けるユーザー指示を適用する。

## 設計と実装箇所

`twoPlyMinimaxAi.ts`のevaluateSearchPositionBreakdownが終局をroot視点のwin/loss/drawと±Infinity/0に変換し、evaluateNoLegalActionsPositionBreakdownが両玉ありの合法手なしrootを既存規則で評価する。この評価関数と係数は変更しない。通常の±Infinityは同ファイルの終局評価、探索の初期値、窓端、静止探索の王手時初期値に使われていた。後者の用途を終局値から分離する。

`searchValue.ts`の内部値は`loss < non-terminal < win`の辞書順。勝ちはterminalDistancePly昇順、負けは降順、非終局と引分は従来の数値評価で比較する。任意の数値評価（オーバーフローしたInfinityを含む）より勝敗カテゴリを優先し、巨大有限Mを使わない。窓端bottom/topは全ての局面値の外側。引分は距離を持たない。

通常再帰の既存plyはroot候補直後が1。静止探索への新しい内部統合入口へそのまま渡し、q着手ごとに1加算する。root終局の概念上の距離は0。距離は評価した葉のroot-plyであり、全幅の強制勝利証明やcheckmate限定のmateDistanceではない。状態のendReasonを改名・推測・変更しない。既存決着理由のwin/lossすべてを対象にする。

`twoPlyAlphaBetaAi.ts`の通常再帰、alpha/beta更新、枝刈り、root最善手、root同点再探索、partial-root候補比較が共通の比較を使う。通常ノード同点は先行候補、root同点は元合法手index。反復深化は従来どおり完了反復を引き継ぐ。qも同じ値・窓端・比較を使い、通常時stand-pat同点優先、王手全回避、q深さ制限と深さ0静的近似を維持する。未探索の静かな局面へ終局や距離を付けない。

fail-softの窓関係は内部値で判定する。rootの早いindexへ同点boundが返った場合だけ従来の無限窓再探索を行う。partial-rootのq結果はbottom窓、またはalphaを厳密に上回った場合だけexact候補にできる。static/既に終局した深さ1の葉は直接評価のためexact。**数値±Infinityの窓端一致は距離までexactと限らない**ため旧absolute-endpoint例外を廃止した。同点のq boundを採用しない回帰へ変更し、異距離のexact候補を比較する回帰も追加した。これはアサーション緩和ではなく、距離を含むexact判定の強化である。

deadlineの時計読取り・確認位置とpending→承認の順序は変更しない。最深完了反復→期限内exact partial-root→fallbackの優先順、partialのcompletedDepth=0と統計契約、期限切れ候補棄却を維持する。

## 公開契約

新しい距離メタデータを公開しない。公開selectedEvaluationとevaluationBreakdown.totalは従来どおり一致し、終局win/lossは±Infinity。内部順位は公開数値と別概念である。内部値、PV、評価内訳を同じ採用候補から伝播し、公開APIには内部値を漏らさない。既存の数値窓q入口は互換ラッパーとして保持する。Worker/型/結果検証/UI/self-play/v1保存形式を変更しない。fallbackは評価null・内訳null・PV空で距離未取得。既存の保存・復元/旧データ/UI/Workerテストを通常checkで実行する。

## 独立参照と回帰局面

`terminalDistanceReference.ts`は製品の比較・探索・順序・枝刈り・q実装を呼ばない全合法手のminimax。非終局評価とルールAPIは共有し、外部エンジンから独立したルール証明ではない。通常/q条件を独立再現し、勝敗カテゴリ・距離・数値を別実装で比較する。未知の非終局は勝敗カテゴリに昇格しない。全幅でwin/lossとなる限定局面についてのみ、設定した探索範囲内で強制勝敗距離が確認できる。

PR #190のmixed-distanceで、1ply/3ply勝ちの両候補とno_legal_actionsの即時勝利を検証する。候補順反転と先後反転でも短い勝ちを優先する。旧resistanceのcheckmate-only 4/2plyは一般の終局距離証明として使わない。

新しいterminal-resistanceは後手玉(0,1)、先手玉(2,0)、先手金(1,5)/(2,1)、後手番。後手玉(0,0)は2ply、(0,2)は4plyで必敗となる。先後反転も確認する。省略駒は盤外で持駒に加えない構成局面であり、平手からの到達可能性は主張しない。`find-terminal-resistance.ts`が全勝敗終局を対象に最初に発見した局面（75候補目）で、探索結果を見て旧診断局面を変更していない。発見出力はresistance-discovery.json。

参照監査は全root候補の値/PVを保存し、全幅と逆順全幅の値一致、製品の枝刈り付き結果との一致を通常d4、d3/q1、d1/q0/1/2で検証する。PVは毎手合法再生し、内訳を再評価して一致確認。checkmate/no_legal_actionsはended状態の合法手ゼロゲートに頼らず、resultを外して全合法応手と王手状態を再確認する。

## 今回の測定計画

旧10局面＋新必敗の先後2局面。standard評価/通常順序/killer=false/q original+1、固定d4を各1本、100ms/1,000ms・最大d4を各5本。各局面・予算・実装で先に1本warmupし、本測定から除外。実装先行順は反復ごとに交替する。同じプロセス内で同じ依存・入力保護を使い直列実行。テスト/build/別の性能測定とは並走しない。環境・ソースhash・入力hash・測定順序をplan、全API結果・実時間・API内時間をrawへ保存する。

期待する変化は異距離の終局選択、終局PV/理由、距離比較で必要になる探索ノード。非終局評価係数・合法性・公開値と内訳整合・source/depth/保存契約は変えてはいけない。固定深さの非終局対照について選択/評価/PV/訪問数を照合する。時間制限下では同じ時間でも完了深さが変わりうる。p50/p95はnearest-rank、最大超過はmax(0,実呼出し時間−予算)。OS負荷・JIT/GC・電源・CPU affinityは固定しない。一般棋力や速度改善を断定しない。

## 検証・測定結果

今回の実測は2026-10-20 21:30:34〜21:34:35 JST、Windows 10.0.26300 x64、Intel Core i7-14650HX、Node v24.20.0、npm 11.17.0。同じ依存を共有した独立checkoutで測定した。mainは上記基準SHAのtracked差分なし。candidateのHEADは基準SHAのまま変更ファイルを複製した検証checkoutであるため、計測した実装をSHAだけで識別しない。plan.jsonの各ソースhash・tracked diff hash・statusで特定し、最終workspaceの製品4ファイルが同じbyte SHA-256であることを照合した。計測CLI/参照のhash、完全入力と入力hash、実行順序も保存。ログや新規テストのuntracked状態を隠さない。

全336呼出し（warmup72、本測定264＝固定24＋timed240）成功、打切り・例外・欠測0。測定中にテスト/build/別性能測定は実行していない。全PV合法再生、末端内訳完全一致、入力保護と入力hash一致を確認した。新規rawを保存後に監査を再実行し、raw hash・件数・一意性・集計一致を検証した。

| 予算 / 実装 | 実時間p50 / p95 ms | API内p50 / p95 ms | 最大超過ms | completed / partial / fallback |
|---|---|---|---|---|
| 100ms main | 100.746 / 102.162 | 100.718 / 102.129 | 4.237 | 45 / 15 / 0 |
| 100ms candidate | 100.494 / 102.073 | 100.463 / 102.040 | 3.087 | 45 / 15 / 0 |
| 1,000ms main | 588.984 / 1000.705 | 588.951 / 1000.670 | 3.871 | 60 / 0 / 0 |
| 1,000ms candidate | 602.353 / 1001.234 | 602.323 / 1001.202 | 1.815 | 60 / 0 / 0 |

各行n=60。100msのpartial-rootはmate-sente/mate-gote/hirate-exchangeが各5件。candidateの15採用候補すべてを独立全幅q1で再評価し、数値だけでなく勝敗カテゴリと距離も一致。completedDepth=0・既存検証器・期限承認候補の統計契約も監査した。今回の実時間にfallbackはなく、fallback/期限切れ候補棄却は制御時計の回帰で検証する。

距離を比べるコストはある。mate-senteの1,000ms完了深さはmain3→candidate2（各5本）、mate-threeの100msは3→2（各5本）。capture100msはmain全て2、candidateは4本2/1本1、terminal-resistance-gote100msはmain3本3/2本4、candidate全て3。その他は同じ深さ（位置別・全観測はraw）。1,000msの全局面を束ねた実時間p50は13.370ms増、p95は0.530ms増。個別揺れや最大超過の減少から速度改善は主張しない。

固定d4/q1の公開評価、採用PV終局理由/長さ、通常訪問数は次のとおり。距離欄は保存PVの観測であり、mainの距離最適性を意味しない。

| 局面 | 評価 main→candidate | PV終局理由・ply main→candidate | 通常訪問数 main→candidate |
|---|---|---|---|
| mate-sente | +∞→+∞ | checkmate 1→1 | 2828→7168 |
| mate-gote | +∞→+∞ | checkmate 1→1 | 5258→8863 |
| mate-three | +∞→+∞ | checkmate 3→3 | 116→158 |
| mixed-distance | +∞→+∞ | checkmate 1→1 | 39→240 |
| resistance（旧） | −∞→−∞ | no_legal_actions 2→2 | 190→312 |
| terminal-resistance（新） | −∞→−∞ | checkmate 4→4 | 89→407 |
| terminal-resistance-gote（新） | −∞→−∞ | no_legal_actions 4→4 | 86→282 |
| evasion | −1205→−1205 | 非終局 | 693→693 |
| recapture | 599→599 | 非終局 | 2667→2667 |
| capture | 1304→1304 | 非終局 | 715→715 |
| recapture-gote | 599→599 | 非終局 | 1560→1560 |
| hirate-exchange | 1010→1010 | 非終局 | 7913→7913 |

**新必敗局面のmainは玉(0,0)を選び、その保存PVは4plyだが、独立した最適応手の距離は2plyである。candidateは玉(0,2)を選び、その最適終局距離が4ply。** baselineの相手側にも距離優先がなく、長いPVを返したことを延命の証明として扱わない。先後反転ではbaselineも偶然4ply側を選ぶが、candidateは両側で4plyを選択。選択手・完全PV・q訪問数もsummary.jsonに保存する。

非終局対照5局面は選択手・評価・PV・深さ・通常/q訪問数が完全一致（監査assert）。終局を含む局面でノードが増えるのは、従来の数値Infinityによる枝刈りでは距離が不明だった枝を読むため。未証明の距離用枝刈りや探索最適化は追加しない。

新規独立監査は3局面×5条件の15件で、通常探索/q境界/逆順全幅/枝刈りあり製品の勝敗・距離・評価が一致。mixed-distanceに1ply/3ply勝ちと1ply no_legal_actions勝ちがあり、必敗両局面の全root候補が2/4ply敗北となることを確認した。reference.jsonは各候補の参照値/PVを保存する。全幅参照は合法手・適用・通常評価APIを共有するため、ルール実装から独立した外部エンジン検証ではない。

既存PR #190のsummary監査60件、保存全PV・正の詰み証明書・終局応手なし再検証も成功。既存診断ディレクトリは基準mainから差分0。これらは旧原本の再監査であり、新規測定件数に含めない。

初回のroot checkoutでのcheckは、途中で作成した比較worktreeまで自動検出し中止した。UI timeout（5秒超過）と誤検出を含む原本はvalidation/check-contaminated-interrupted.txt。比較checkoutを許可済み出力ディレクトリへ移動し、既存worktreeに触れず通常設定を使う独立checkoutで再検証する。baselineの通常checkは74ファイル/1,977件、型/lock/build成功。重点回帰の初回は2ファイル/57件成功（後続で距離partial回帰を2件追加）。検証環境・通常設定を緩和しない。

引分の全既存理由と実際のq終局捕獲でのroot-ply加算を追加した最終通常checkは**75ファイル/2,002件、lockfile・型検査・build（1,760 modules）すべて成功**。原本はvalidation/final-check.txt。更新した監査スクリプトもrootの最終lintを通過。通常の5秒timeout/2 worker設定を維持し、既存jsdom navigation通知はテスト失敗と区別する。独立checkoutでmain・candidateとも通常checkが成功したため、初回のworktree混入・UI timeoutを製品の不具合と断定しない。失敗/中止結果は保持する。

既存worktreeのstatusは--no-optional-locksで読取り確認した。sandboxでアクセス拒否となった記録と、権限付き再確認の成功結果を別ファイルに保存し、他checkoutの状態を変更しない。Git fetch/branch作成、Windows Temp制約を受けるテスト、ネットワーク操作のみ必要な権限で実行した。

最初のstaged diff --checkは新規ログ2本の末尾空行で失敗した。指摘をstaged-diff-check-initial.txtに保存し、当該2本の元bytesを.txt.gzに保持してから、表示用.txtの末尾改行だけを整えた。ソース・テスト設定・アサーション・測定原本は変更していない。

## 再現

```powershell
# baseline/candidateは既存worktreeを内包しない別checkout。同じ依存を使用。
npm run check
node --import tsx scripts/measure-terminal-distance.ts <baseline-root> <candidate-root> <new-run-directory>
node --import tsx scripts/audit-terminal-distance.ts measurements <run-directory> <summary-file>
node --import tsx scripts/audit-terminal-distance.ts reference <candidate-root> <new-reference-file>
npm run diagnose:tactical -- audit docs/benchmarks/tactical-mate-20261019/run1
node --import tsx scripts/audit-tactical-observations.ts docs/benchmarks/tactical-mate-20261019/run1
```

## 制約・別PR候補

距離は探索で採用した終局葉までの距離で、未探索範囲の勝敗保証ではない。qは静かな応手を読む通常深さの代替でなく、stand-pat/深さ制限を維持する。同期合法手生成・着手適用は協調的確認の間に中断できない。距離で同じInfinity候補を区別するため、従来切れていた探索が必要になり訪問数が増える場合がある。距離用の新しい探索最適化は導入しない。通常深さ到達率や静かな戦術探索、棋力/自己対局の広い評価は別PR候補とする。
