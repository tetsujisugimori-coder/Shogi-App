# PR #176 診断集計のレビュー修正

対象HEADは `c77fe6e60339bab516fe34c0e28d9f7e84aff1e0`。開始時のPR HEADも一致し、fetch後の最新 `origin/main` は `57378c2dfbad1b3d83908cf9dea077824baa4a39`。作業ブランチは `diagnose-legal-action-revalidation`、公開用checkoutは差分なし。別checkoutの既存未コミット変更は操作していない。追加の開発指示ファイルは見つからず、ユーザー指定の指示に従った。開始時CIはUbuntu/macOSとも成功。

## 修正A: 同時診断

`validateDrop` のown-checkにはActionValidationProbeの有無による別実装があり、probeありの枝だけ `isKingInCheckProfiled` を選択していなかった。王手判定callbackを一つにし、`qDiagnostics.checkInternals` があれば詳細版を選択する。そのcallbackを既存q/root計測で包み、最後にActionValidationの包含計測で包む。判定は一度、盤面作成も一度だけ。無診断時は従来の `isKingInCheck` を直接呼ぶ。

board側 `getLegalMoves` は既に同じ選択・包含構造であり、変更不要。両側の詳細診断は既存のq合法手生成own-checkが対象で、実行時検証や打ち歩詰め内部へ新たな詳細診断は広げない。ルールの検証順序、早期return、打ち歩詰め判定は維持する。

## 修正B: root集計の責務

通常内部ノードが `getLegalActions(state, diagnostics)` を呼ぶと、第二引数を使うroot-piece-moves/root-hand-drops/rootDropsへ内部処理も加算されていた。

`getLegalActions` に末尾の任意 `ActionValidationDiagnostics` 引数を追加し、既存の第二引数からの既定値を保つ。内部ノードは第二引数なし・第三引数のみを渡す。generationBoard/generationDropは引き続き計上し、rootのphase、候補、理由別拒否、stageへは加算しない。静止探索の独立列挙器とqLegalCountsは変更していない。

時間制限付き探索のrootでも、第二引数は既存 `rootBreakdown` の設定に従い、ActionValidationだけなら第三引数を渡す。固定深さの既存root呼出しは維持。公開APIの既存呼出しを互換に保ち、公開実行APIの検証は省略しない。

## 回帰テストと修正前の検出

`src/test/shogi-action-revalidation-regression.test.ts` の3テストを追加した。盤面は両玉・両銀・双方に持駒の歩を配置し、成り、盤上手、drop、通常内部ノード、静止合法手生成が実際に発生する。時計注入を利用し、時間制限なしの意味論を比較する。

| 検査 | 修正前 | 修正後の期待を実際に照合 |
| --- | --- | --- |
| ActionValidation / checkInternals のOFF/OFF・ON/OFF・OFF/ON・ON/ON | ON/ONのdrop詳細checksが0で失敗 | 四組合せの合法手配列・順序、全適用後state、探索結果/PV/深さ/訪問数、qLegalCountsが一致。ON/ONでもboard/dropの詳細checksとq own-check呼出数が一致。詳細単独とのchecks/実走査/走査マス/駒判定/早期終了も一致 |
| 固定深さ1・2のroot責務分離 | 深さ2でroot盤上生成2→168回、drop列挙1→84回、root drop候補81→6,804に混入して失敗 | rootの盤上2回・drop1回・候補81を直接root列挙と照合し、理由別拒否とstage件数も一致。内部normal-legalが発生し、両generation件数はroot単独より増加。静止探索ON/OFFの双方を検査 |
| 時間制限付き探索のrootBreakdown=false | root-piece-movesが168回で失敗 | root専用集計は0、board/drop検証は正数。rootBreakdown=trueと探索結果・root候補数が一致し、有効時のroot集計はroot単独と一致 |

executionのboard/drop別件数は公開実行API・validation・board-setup・own-checkで一致し、合計は通常＋q訪問数および通常＋q execute phase件数と一致する。包含時間の非負性と own-check ≤ validation ≤ execute-api ≤ execute-action、生成own-check時間の正数を確認。入力は凍結Proxyで保護し、非破壊を確認する。

修正前にテストのみ追加して実行し、AとrootBreakdownの失敗を記録した。固定深さAPIにはdepthOneがないためroot候補の検査を戻り値のrootLegalActionCountへ訂正したうえで、Bを別途実行して上表の混入を検出した。アサーションや標準設定は緩めていない。

## 過去の測定証跡

`action-revalidation-*-20261009.jsonl` の5系列と `action-revalidation-comparison-20261009.md` は対象HEADから変更なし。旧auditも変更なし。比較監査の再出力は別名 `action-revalidation-audit-20261010.md` とし、旧結果を上書きしない。

測定器のfixed-onは `new SearchDiagnostics(false, true, false, true)` を用いるため詳細王手診断を併用しない。修正Aの詳細版選択の差は起こらず、粗いown-checkの包含範囲と呼出回数は同じ。fixedは深さ1で、root適用後のremainingDepth=0から静止探索へ入るため、修正Bの通常内部ノード列挙を通らない。rootBreakdownは有効。timed/fixed-offとmain比較系列は診断OFF。旧固定深さ1・単独診断の件数・結論は影響を受けず、再測定は必要ない。現在のコードで時間を再測定した値とは主張せず、旧時間値と環境・SHA・測定条件をそのまま保持する。

## 検証

Windows / Node v24.20.0 / npm 11.17.0。ローカルsandboxの既知EPERMを避けるため、テストプロセスのみnative realpathのEPERM時に標準resolverへfallbackし、TEMP/TMPをworkspace内へ変更。preloadはリポジトリに含めず、製品コードやアサーション・timeout設定を変更しない。

- 新旧ActionValidationテスト: 2ファイル7件成功。最終の関連実行: 新旧診断・合法手・静止探索・timed-depth-oneの5ファイル65件成功、標準5秒。
- `npm run check`: 通常2 worker設定は既存 `quiescence-ordering-repeated` の同期大量assertionテストが7.56秒で標準5秒を超えたため中断。lockfileと型検査は成功。1 fork・標準5秒で再実行し、65ファイル/1,759件中1,758件成功、同じ1件だけ7.07秒でtimeoutとなり終了コード1。timeoutを延長した成功として扱わない。残りの合法手・探索関連テストは全件成功した。
- `npm run build`: checkはテスト段階で失敗するため別途実行し、1,758 modules、production build成功。アプリの設定変更はなし。
- `audit:action-revalidation`: 旧TIMED/OFF/ON/MAIN_TIMED/MAIN_FIXEDを引数に渡し、独立5系列140探索標本・合法手順序・全root適用後stateの監査成功。
- `audit:check-internals -- docs/benchmarks/check-shortcircuit-after-20260924.jsonl`: 4局面、OFF 28/ON 28標本成功。
- `audit:q-legal-breakdown -- docs/benchmarks/q-legal-breakdown-final-20260924.jsonl`: 4局面、timed 56/fixed 28標本、q集計・独立root集計成功。
- `audit:check-shortcircuit`: before/after、legal-before/after、fixed-before/afterの6ファイルを渡し、4局面比較成功。
- `git diff --check`: 成功。

更新HEADのCI結果はGitHub反映後にPRコメントで報告する。自動マージは行わず、独立レビュー後に判断する。

## 非変更事項・残存リスク

将棋ルール、合法性・公開実行APIの安全性、探索アルゴリズム/alpha-beta/評価/手順序/静止探索の仕様、時間制御/fallback/Worker/UI/棋譜形式は変更していない。検証省略、検証済み手専用適用経路、高速化、キャッシュは追加しない。

今回のテストは固定深さ1/2およびtimed最大深さ2の同期診断を対象とする。診断時の包含時間を通常探索の性能差に外挿しない。将来の診断追加も、rootと内部生成、粗い計測と詳細計測の組合せを維持する必要がある。
