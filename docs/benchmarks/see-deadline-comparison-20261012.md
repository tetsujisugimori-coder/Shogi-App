# SEE内部へ探索中断確認を伝播する修正

## 基準と調査

2026-10-12 JSTに `origin/main` をfetchし、full SHA `5d1f83ed9db821c445f295eb15e365491740acea`（PR #176マージ）から `fix-see-cooperative-deadline` を別worktreeに作成した。元mainの作業ツリーはclean。親階層・リポジトリ内に追加AGENTS.mdはなく、ユーザー指示の日時記載に従った。既存未コミット変更・既存測定ファイルは変更しない。

[PR #152](https://github.com/tetsujisugimori-coder/Shogi-App/pull/152)の全反復deadline・合法fallback契約、[PR #176](https://github.com/tetsujisugimori-coder/Shogi-App/pull/176)本文・レビュー修正コメント・リポジトリ内の比較資料を確認した。#176は再検証の省略を最優先とは結論していない。

八兵衛の報告はユーザーから提供された背景で、対象は旧main `57378c2dfbad1b3d83908cf9dea077824baa4a39`。#152/#176/#177の公開コメントおよび関連ローカル資料から具体的な局面・全設定を取得できなかった。以下は最新mainで別局面を測定した結果であり、報告局面の再現・解消証明ではない。

## 呼出経路・設計

`orderAlphaBetaNodeActionsByMode` → 2捕獲以上の場合だけ `prepareStaticExchangeEvaluation` → 各捕獲評価 → `evaluateExchangeContinuation` → 合法な取り返し候補の適用・再帰、という経路だった。従来の中断確認は最外の各捕獲前後だけで、準備・一交換系列全体は確認なしだった。

準備の末尾に任意 `interruptionCheck?: () => void` を追加して探索の同じcallbackを渡す。開始・合法手生成後、各評価開始・baseline評価後、各再帰ノード進入・駒得評価後・合法手生成後、候補適用前・再帰後・最終返却前で確認する。ノード進入が親の適用直後・再帰呼出し直前の確認を兼ねるため、同じ境界で重複確認を増やさない。早期終局・合法手なしのreturnにも直前の確認が届く。

SEE側にcatch・時計・deadline・再帰上限・枝打切り・近似・キャッシュは追加しない。投げた例外をそのまま伝播する。`SearchDeadlineExceeded`のみを既存の反復ループで捕捉し、未完了反復はiterations/完了統計へ入れない。通常の不正入力・計算エラーは呼出側へ伝播する。中断した共有準備と局所の部分手順序は反復のスタックごと破棄され、0/nullを返さない。入力・持駒・履歴・評価設定は変更しない。

公開SEEの引数とbarrelは変更しない。任意callbackを省略する既存の準備APIも互換。standard経路には入れず、静止探索original/materialもSEEを使わない。

**要求Cの呼出経路上の制約:** 深さ1ではpreviousBestActionがnullのrootを元順のまま処理し、子はremainingDepth=0の評価または静止探索へ進む。深さ1にはSEE順序付けがない。深さ1にSEEを新設することは範囲外の手順序変更となるため、深さ1の期限/fallback/SEE未開始を検査し、実際のSEE内部deadlineは深さ2で検査した。

## 決定的な回帰・互換性

新規 `shogi-see-deadline.test.ts` を先に追加して基準mainの製品ソースで実行した。初版14件中12失敗・2成功。再帰中断・準備/候補境界9件は「例外を投げなかった」、注入時計による深さ2は「SEE内部で捕捉していない」、確認あり互換性は「callback回数0」で失敗した。修正後に成功。テスト開発中、固定深さと反復深化の探索統計を同一視した期待値は、前回最善手優先で訪問数が違うため訂正した。基準mainから各API別に採取したfull snapshotと照合するようにした。

- A: 最初の捕獲＋最初の取り返しの適用2回後、SEE内callbackが例外を投げ、次の合法手生成に入らない（生成は準備＋最初のcontinuationの2回）。外側の呼出前後確認では通らない。
- B: 準備開始/生成後、評価開始、baseline後、初手適用後、取り返し生成後/適用前/適用後、次continuation生成の各境界で例外伝播・停止後の生成/適用/駒得回数・凍結入力を確認。さらに実際に取り返しのないleafまで進め、結果返却前と親の再帰復帰直後で停止する2件を追加した。
- C: 深さ1で実着手後に注入時計が期限へ到達し、completedDepth=0、timedOut=true、先頭合法手fallback、評価/内訳null、空PV、iterations空、完了統計0。SEE準備は0回。
- D: 深さ1完了後、深さ2のSEE内2適用目で時計を100へ進める。探索が渡したcallbackがSEE内部で既存deadline例外を投げ、SEE適用は2回で停止。結果全体は深さ1だけの結果と一致（要求深さ・timeout・経過時間だけ異なる）。
- E/F: 基準mainで採取した `fixtures/see-deadline-baseline.json` のSEE値・全手順序・固定深さ2・完了反復深化2の選択手/評価/PV/内訳/全統計を完全一致検証。standard省略/明示の結果一致・SEE準備0回、公開APIも比較。既存SEE・順序付けテストで複数取り返し、成り、強制取り返し、任意停止、同点元順も検査する。
- G: 正常/中断/通常計算エラー時の凍結入力とsnapshot一致。SEE内の通常RangeErrorは時間制限付き探索を通っても同一例外のまま伝播。既存テストの不正入力・非有限値も維持。

既存の観測用SEE spyは任意callbackを転送するよう修正。外側の候補前後確認テストだけ、内部callbackを持たない評価stubで外側を独立検証し、内部境界は新規テストで実評価する。既存SEE意味論の全ケースにprepared-with-checkを追加し、公開/準備のみ/準備＋確認の3経路で同じ期待値を検証する。アサーション・timeoutを緩めない。

## 修正前後の実時間測定

環境: Windows `win32 10.0.26300 x64`、Intel Core i7-14650HX、Node v24.20.0、npm 11.17.0。局面ID `see-deadline-branching` は既存SEEの複数取り返し・香車開き利きテストから構成した9駒の人工局面。玉2、先手飛車/香車/角/銀、後手歩/飛車/金。持駒・履歴は空で偽造しない。局面全体をJSONLへ保存し、`createSeeDeadlinePosition()`で再現できる。捕獲候補が2つ以上あり、実際の準備・再帰は決定的テストで確認した。

明示static-exchangeと比較用standard、標準評価、killer省略、静止探索無効、最大深さ4、100/1,000ms。各条件を別childで2ウォームアップ＋5本測定、修正前系列→修正後系列を直列実行し、テスト/buildと重ねない。経過時間は探索APIの直前/直後で計り、局面作成・プロセス起動を除く。親は各呼出しを20秒で検証用打切り。製品Workerは変更しない。測定はpreloadなし。

両系列のHEADは基準main＋dirty=true。beforeは製品ソース無変更、afterは今回のcallback伝播差分。JSONL configに基準full SHA、HEAD、OS/CPU、開始日時、測定器・局面・製品ソースのSHA-256を保存した。各sampleはwarmup/本測定区分、全設定、経過時間、正常/打切り/エラー、全検索結果（深さ/timeout/resultSource/選択手/評価/PV/iterations/統計）を保存している。測定器・局面ソースは前後同じ。

測定後に測定器の未発生の打切りレコードだけを修正した（pendingのtype='started'がtype='sample'を上書きしないようspreadの順を訂正）。正常復帰した56標本や製品ソースには影響せず、測定時の測定器SHAはJSONLの `0ffeffd4e90fa2c21466f78c18a22f5490ea7b91f2f7bb1859aab26135cc9ff3` のまま保持する。

| 設定 | 指定ms | 修正前 min / median / max ms | 修正後 min / median / max ms | 前後の本測定の完了深さ・timeout |
| --- | ---: | --- | --- | --- |
| static-exchange | 100 | 100.065 / 100.083 / 100.423 | 100.082 / 100.096 / 100.129 | すべて2・true |
| static-exchange | 1,000 | 622.840 / 637.696 / 644.205 | 631.975 / 656.586 / 671.241 | すべて4・false |
| standard | 100 | 100.063 / 100.086 / 100.100 | 100.072 / 100.086 / 100.114 | すべて3・true |
| standard | 1,000 | 180.694 / 189.664 / 200.439 | 186.165 / 190.288 / 199.363 | すべて4・false |

全56標本（前後各28、うち各20本測定）は正常復帰、検証用打切り0、エラー0。本測定は全てcompleted-iteration。100ms SEEは評価1110、standardは1304、1,000msは双方1161。選択手は角2,2→4,0成り。前後の対応条件の選択手・評価・PV・完了深さは一致。全PVの手と統計は[before](see-deadline-before-20261012.jsonl)・[after](see-deadline-after-20261012.jsonl)を参照。

この局面では15秒超を再現しなかった。100ms経過の小幅差や1,000ms完走の中央値増加はこの1台5標本の順序/JIT/GC/負荷・callback費用を含むため、速度改善/一般的な性能差/原因を断定しない。SEE内部で止まったことは決定的テストの根拠で、経過時間のみから推定しない。実時間の数ms差をCIゲートには使わない。

再実行: `node --import tsx scripts/measure-see-deadline.ts before|after NEW.jsonl`（既存出力はwxで拒否）。beforeというラベルだけで旧コードへ切り替わらないため、旧コード比較には記載の基準SHAのcheckoutを用いる。

## 検証と残存事項

最初の関連9ファイル224件成功。最終の関連9ファイル325件成功（SEE、順序、静止探索、深さ1診断、時間超過、既存alpha-beta/反復深化のテスト）。通常2 worker・標準5秒の `npm run check` はlockfile/型検査/66ファイル1,774件/build成功。追加の意味論・返却境界テスト後の最終check結果は後段へ追記する。

最終 `npm run check` も通常設定で終了0。lockfile/型検査/66ファイル1,810件/build（1,758 modules）成功。テスト118.30秒、build9.90秒。既存jsdom navigation未実装通知は失敗ではない。補助実行は `npm test -- src/test/quiescence-ordering-repeated.test.ts --pool=forks --maxWorkers=1`、標準5秒のまま37件成功（テスト1.56秒、全体2.58秒）。#176の7秒台の既存timeoutは通常check・補助単独の双方で今回再現しない。補助結果を通常全check成功の代わりには用いていない。`git diff --check`成功。

測定後のJSONL監査で前後の完全な初期state一致、各28標本の正常復帰、全20本測定ペアの選択手/評価/PV/完了深さ/timeout/resultSource一致を確認した。CIは公開後に最終HEADを確認し、PR本文・完了報告へ記録する（CI結果追記でHEADを繰り返し変更しない）。

Windows sandboxではnative realpathのEPERMが発生したため、検証プロセスだけEPERM時に標準realpathへfallbackするPR外preloadとworkspace内TEMP/TMPを使用した。測定には使っていない。Vitestの設定・pool・worker数・timeout・テスト本文の期待値は緩めない。PR #176の通常2 worker既存大量assertion timeoutは今回の通常checkでは再現しなかった。補助実行の結果は通常checkと分けて後段に記録する。

単一の同期処理は強制中断不能。特にroot合法手生成によるfallback確保、SEEの合法手生成・公開着手適用（再検証・履歴・反復・終局判定）・複製/駒得評価自体の途中は止められない。今回、交換系列全体ではなく次の境界へ戻るたびに期限確認できるようにした。100ms厳密復帰・棋力改善を保証しない。次工程で長い同期処理を検討する場合も、まず実処理量を別途確認する必要があり、公開合法性検証の省略・専用適用経路・Worker強制終了の採用を今回の結果から推奨しない。
