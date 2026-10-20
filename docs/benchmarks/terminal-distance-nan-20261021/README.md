# PR #192 P2: 探索内部のNaN拒否

対象・開始HEADは`96803e3db338855ae5ea7d1ac82d8add275fc3df`。origin/mainとPRブランチをfetchし、main=`6cd961b699a9985a0ff73ca6a93bb7bbdaa2b2ef`、PR OPEN・最新HEADと対象SHAの差分0、重複修正なしを確認。PR本文を読んだ。取得時のGitHub reviews/commentsは空で、P2の内容は今回のユーザー指示を根拠とする。既存の`codex/terminal-distance`を継続する。開始checkoutはclean、worktree一覧を確認し、既存worktree・未コミット変更・保存済み診断原本は変更しない。通常checkが既存worktreeを自動検出しないよう、今回も新しいbefore/after独立checkoutで検証する。

## 原因と発生条件

従来compareSearchValuesの非終局分岐は、等値でなければ`left > right ? 1 : -1`だった。NaNでは等値も大小判定もfalseなので、`compare(NaN,1)`も`compare(1,NaN)`も負となり、反対称性を満たさない。違うカテゴリとの比較では順位判定が先行し、不正な値が見逃される。

入口は(1)searchValueのbreakdown.total、(2)数値q窓のnumericalSearchBound、(3)構造型SearchValueの直接生成。型のnumberだけではNaNを排除できない。通常再帰・q・minimax・反復深化へ伝播し、候補選択や窓更新を誤る可能性があった。partial-rootの旧テストもNaNを無視して既存候補/fallbackを返すことを期待していた。

既定の評価表・係数と正規の駒数は小さく、今回その正常設定でNaNを生成する経路は確認していない。係数は既に有限・非負を検証するが、有限入力からの演算結果の有限性までは保証しない。カスタム表は汎用的な入力検証を持たないため、明示NaNも流入し得る。

実際に確認した異常経路:

- 平手で歩価値を有限のNumber.MAX_VALUEにすると両側の駒得合計がInfinityになり、差のInfinity−InfinityがNaN。
- 既存recapture構成局面で全係数を有限のNumber.MAX_VALUEにすると、駒得項は+Infinity、位置項は−Infinityとなり、合算がNaN。
- NaNを含むカスタム歩価値、直接の数値窓、直接生成した比較値も拒否対象。

評価関数の式・表・係数の既定値は変更しない。生の評価計算APIは従来どおり計算結果を返すが、そのNaNを探索値として取り込む時点で拒否する。

## 最小修正と伝播

`searchValue.ts`で共有検証を追加。searchValueは非終局/引分のNaN評価を拒否し、numericalSearchBoundはNaN窓を拒否する。compareSearchValuesは両オペランドをカテゴリ順位比較より前に検証する。直接渡されたwin/lossのNaN距離も拒否する。

RangeErrorのメッセージはそれぞれ`Search non-terminal evaluation must not be NaN.`、`Search numerical bound must not be NaN.`、`Search terminalDistancePly must not be NaN.`。0やInfinityへの置換はしない。有限値・非終局±Infinity・drawの0/距離なし・win最短/loss最長・bottom/topは維持する。

比較再帰を通らない深さ0や合法手なしrootでもNaNを返さないよう、alpha-betaのroot直接返却3経路とminimaxの解析root経路に同じsearchValue検証を追加した。評価の再計算・新しい時計読取り・期限確認位置の移動はない。

通常探索/q/minimaxからのRangeErrorはそのまま呼出し元へ伝播する。時間制限探索は既存どおりSearchDeadlineExceededだけを時間切れとして処理し、RangeErrorを再throwする。完了済みpartial候補があってもNaNで黙って復帰しない。期限が先に到来し評価を開始していない場合は従来fallbackのまま。Workerでは既存のfailure応答にerrorName/messageを運び、成功fallbackには変換しない。新しいcatchは追加しない。

## 回帰と修正前再現

新規`shogi-search-value-nan.test.ts`で有限/同値/非終局±Infinity・終局異距離・引分・窓端の全組合せと反対称性、両側直接NaN・異カテゴリ比較・NaN距離・NaN窓、実際の有限オーバーフロー、alpha/q/minimax/反復/時間制限/root直接返却/途中候補/Worker失敗伝播を検証する。

初版25件の修正前実行は22失敗/3成功（red-initial.txt）。root/Worker/深さ0を追加した30件は27失敗/3成功（red-final.txt）。初回のroot経路テストは同一モジュールの内部呼出しがexportのspyへ置換されない問題を含んだため、最終版では実際の合法手なし・玉なし解析fixtureへ修正した。これは既存APIが扱う解析入力で、正規対局局面とは主張しない。

最終の実fixture版も修正前27失敗/3成功（red-final-real-fixture.txt）。修正後はNaN30件＋関連partial/終局距離を合わせた3ファイル/95件が成功（focused-final.txt）。

既存partial-rootのfail-lowアサーションは維持し、NaNを含む場合を独立したthrow必須テストへ強化。旧「NaNならfallback」は今回の明示要求に従い「NaNなら例外」に変更し、未評価の時間切れfallbackの検証は維持する。timeout/worker数/アサーションを緩和していない。

## 正常結果の比較

`compare-search-value-nan.ts`で既存12局面×7条件（alpha深さ0/2、深さ4/q1、2手minimax、反復深さ3/q1、q2、制御時計の時間制限深さ3/q1）＋制御時計によるfallback/partial3条件、合計87件の修正前後が一致。

除外したのはtop-level/iterationsのelapsedMillisecondsだけ。選択手、公開評価、評価内訳、全PV、root基準の観測終局距離、深さ、反復、source、timeout、partial metadata、全探索統計を完全比較した。各PVの合法再生/内訳再評価と入力非破壊も確認。normal-comparison.jsonは両結果を保持する。これは正常結果の再現比較で、新しい時間性能測定ではない。旧PRの時間測定原本は再実行・書換えしていない。

## 全体checkと失敗記録

重点回帰初回は3ファイル/93件成功、型検査成功。後続でWorker/rootケースを追加した。

初回全checkは新rootテストのモック不備で1失敗/2,032成功（check-test-mock-failure.txt）。実fixtureに修正した最終通常`npm run check`は**76ファイル/2,033件、lockfile・型検査・production build（1,760 modules）すべて成功**（final-check.txt）。通常の5秒timeout・2 workerを維持する。既存jsdom navigation通知は失敗と区別する。製品コードは初回checkから変更せず、テストの入力だけを修正した。

比較に使用したbefore/afterと最終workspaceの製品3ファイルbyte hash、比較原本・CLIのhashをmanifest.jsonに保存。既存のterminal-distance-20261020/tactical-mate-20261019は対象SHAから差分0。今回のログは新しいディレクトリにのみ保存し、末尾空行を整える場合も元bytesをgzipで保全する。

## 再現

```powershell
npx vitest run src/test/shogi-search-value-nan.test.ts src/test/shogi-partial-root.test.ts src/test/shogi-terminal-distance.test.ts
npm run check
node --import tsx scripts/compare-search-value-nan.ts <96803e3-checkout> <fixed-checkout> <new-comparison.json>
```

比較は新規出力のみ。既存PRのブランチにcommit/pushし、最終HEADとCI対象SHAの一致を確認する。新PRは作らずmainへマージしない。生の評価表の汎用検証、NaN以外の任意の壊れた構造型の検証、距離用枝刈り/最適化は今回の対象外。非終局±Infinityの既存意味を維持する。
