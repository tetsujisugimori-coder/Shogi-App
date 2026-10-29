# 対局の逐次保存と1000ms再比較

Issue [#215](https://github.com/tetsujisugimori-coder/Shogi-App/issues/215)、PR [#214](https://github.com/tetsujisugimori-coder/Shogi-App/pull/214)の途中棋譜未保存を解消する検証。基準mainは `4009cd0e808553af8f0ec9e01411a3eb6714560d`。設計は実装前に[design.md](design.md)へ記録した。

## 実装と保存保証

`scripts/benchmarks/journalIO.ts` は型付きJSONL、SHA256チェーン、strict reader、exclusive create、short write処理、同期fsyncを提供する。元の数値・文字列・null・undefined・欠落フィールドを曖昧に変換しない。NaNは拒否する。`matchJournal.ts` は既存self-playを1手ずつ実行して確定記録を保存し、保存が戻ってから次の探索へ進む。製品の探索・評価・規則・Worker・UI・利用者向け棋譜形式は変更しない。

途中でファイル書込み/fsyncが失敗するとwriterを使用不能にして実行を失敗にする。終了行の追記で不完全行を隠さない。容量不足は書込み前に拒否し、reserveで容量停止の終了行を保存する。保存前に計算済みだった手は棋譜に数えない。親監督ログは実行失敗・保存失敗・ハード停止を区別する。子自身が保存するので親のメモリだけには依存しない。強制終了時の終了行、電源断・媒体故障への耐性は保証しない。

各手の`apiMs`は探索API呼出しの外側計測、`search.actualElapsedMilliseconds`は既存計測ラッパーの値、`search.elapsedMilliseconds`は探索内部値。終了行の`apiMs`は保存済み手の合計、`uncommittedApiMs`は失敗/容量拒否/手を伴わない終局確認の探索時間。`saveMsBeforeEnd`は開始・各手のエンコード/書込み/fsync、`wallMsBeforeEnd`は入力検証後から終了行生成までで合法手検証・局面hash・保存も含む。終了行の保存費用を含む値はsupervisorのdoneレコードの`saveMs`と`wallMs`、プロセス起動終了も含む値はgame-exitの`wallMs`に分ける。容量拒否の失敗したエンコード費用はwallにだけ含む。

完全なLF終端行の後の断片は切詰めず報告し、その前まで合法再生する。改行で終わる破損行や途中の欠落・重複・逆転、未知schema、意味の矛盾はcorruptとする。未完了・破損は正式比較へ混ぜない。片側だけ完成したペアは個別結果を保持し、完了ペアに含めない。同一原本の重複は1回、同じgame identityで異なる原本は衝突エラー。署名ではないため意図的改ざんの防止は主張しない。

初期局面は全BoardState、全棋譜とsnapshot/repetition/check履歴を保存する。schema 1の開始入力は初手から履歴が揃ったactive/check局面に限定し、過去手順も既存合法手APIで再生して照合する。人工局面は初期snapshotを起点とし、平手からの到達可能性は主張しない。開始後の規則は既存runSelfPlayGameが扱い、PV葉の内訳も再計算する。

旧JSON棋譜由来stateではPiece.isPromotedのundefined属性が省略される。初期履歴の再生照合に限り、この属性の「欠落」と「undefined」を同じとする。false/trueや他属性の差は許容しない。journal原本、探索結果、手を適用した後の全状態hashはこの正規化を行わず、型付き表現でそのまま保持する。初回prepareはこの差を拒否して測定開始前に停止した。11か所の診断はvalidation/initial-provenance-difference.jsonl、修正後は旧JSON形式の6手棋譜を回帰で検証する。

## 固定条件と再現

旧 `piece-safety-20261025/run2/plan.json` の平手/6手合法棋譜由来の完全stateとoptsを使用する。先後交換2ペア、計4局。1000ms、max d4、120ply、standard評価、通常standard/q1 original、成りOFF、check evasion extensions 0、TT/PV/killer OFF。今回の全局は新しいrun IDで開始し、旧runへ継ぎ足さない。

旧matrixと共有した15分予算から対局専用の直列実行へ変更。1局ソフト290秒（手の境界）、親ハード300秒、run全体22分。4局journal各16MiB（終了reserve64KiB）、plan/source合計4MiB、supervisor1MiB、合計最大69MiB。ハード停止後は終了行なしでもprefixを監査する。OSのI/O停止までプロセス内のソフト期限で保証するものではない。測定時にtest/build/別性能測定を並行しない。

```sh
npm ci
npm run lint
npx vitest run src/test/match-journal.test.ts
npm test
npm run build
# prepare時のHEADとsourceを固定し、runまで変更しない。
node --import tsx scripts/measure-match-journal.ts prepare NEW_RUN_DIRECTORY
node --import tsx scripts/measure-match-journal.ts run NEW_RUN_DIRECTORY
node --import tsx scripts/measure-match-journal.ts audit NEW_RUN_DIRECTORY NEW_AUDIT_1
node --import tsx scripts/measure-match-journal.ts audit NEW_RUN_DIRECTORY NEW_AUDIT_2
# plan/source/supervisorなしでも、journal単体で合法再生・再集計できる。
node --import tsx scripts/replay-match-journals.ts NEW_REPORT game1.jsonl game2.jsonl
node --import tsx scripts/seal-match-journal.ts originals
node --import tsx scripts/seal-match-journal.ts verify
node docs/benchmarks/match-journal-20261026/verify-index.cjs
git diff --check
```

出力ディレクトリはすべて新規とする。runのsupervisor.jsonl自体がexclusive lockであり、再開・上書きを拒否する。audit/replayも出力先を新規作成する。auditではplanとの同一性も追加検査し、未実行を数える。standalone replayでは予定外の存在を推測しないため未実行は判定できない。未知schema/監査失敗はexit 1。テストの故障原本を残す場合は `MATCH_JOURNAL_EVIDENCE` に新規ディレクトリを設定する。

再現は記録source SHAのcheckoutまたは保存source gzipを使う。新しいHEADで再測定したものは独立runとして扱う。ソースhashはLF正規化、原本証拠はbyte単位。既存1087ファイルのhashは `protected-originals.json` に保存し、旧原本は編集しない。

sealのoriginals/verifyは旧原本の作業時bytesも照合するため、別OSで旧テキストの改行が変換されたcheckoutでは旧原本のhashが一致しない場合がある。今回の新証拠はすべて-textで保護し、別OSでもverify-index.cjsでGit index中のmanifest全項目をbyte検証できる。コミット前の検証には先に証拠をstageする。

## 検証記録と制限

- GitHubコネクタは利用不可、sandbox git fetchはschannel認証コンテキストエラー。通常権限のGitHub CLIでfetch・マージ・レビュー・Issueを確認し、TLS検証を無効化していない。既存node_modulesを使用し、この作業でnpm ciを再実行していない。Node 24.20.0/npm 11.17.0、環境詳細はenvironment.json。
- 初回テスト起動はesbuildの親ディレクトリ読取り権限で失敗（attempt1.log）。通常権限の初版29件は成功（attempt2.log/故障原本）。初回型検査は新規テストのreadonlyオプションへの代入を拒否し、オブジェクト置換に修正した。既存テストの期待値・timeoutは変更しない。
- 初版故障原本は終了行にuncommittedApiMsを追加する前の開発途中記録であり、最終版の正式比較へ含めない。最終故障fixtureは別ディレクトリに保存する。
- 棋力向上をこの2ペアから断定しない。保存・fsyncによる探索間の負荷とOS/JIT変動があるため、旧実時間結果との完全一致を要求しない。決定的fixtureの全探索結果と選択手はjournal有無で比較する。
- ピン・合法取り返し・独立した深い参照評価・大標本対局は次段階。既定legacy、experimentalは研究opt-inのまま。

## 実対局結果（監査済み）

**journal受入：PASS。1000ms再比較：4/4局・2/2ペア完了。一般棋力改善：未実証。**
測定source SHAは `05cbb8cdfe3b7574a630d22a3dfb9a75d379fdcb`、run IDは `journal-a96be37b-5da3-45c1-b4d8-386a7a5230c8`。
原本は[run1](run1)、監査・再生成は[audit1](audit1)、[audit2](audit2)、planなし・重複入力を含む[standalone](standalone)。全394手の合法性、PV、評価内訳、最終状態hash、終局結果を検証した。

|開始局面|先手 / 後手|手数|終了|勝者|
|---|---|---:|---|---|
|平手|legacy / experimental|115|詰み|legacy（先手）|
|平手|experimental / legacy|91|詰み|experimental（先手）|
|6手合法棋譜由来|legacy / experimental|120|手数打切り|なし（引分とはしない）|
|6手合法棋譜由来|experimental / legacy|68|詰み|legacy（後手）|

legacy 2勝、experimental 1勝、規則引分0、手数打切り1。実行中断0、破損0、未実行0、未完了0。
ペアの完了は双方の規則終局または手数上限と監査成功を意味し、勝敗決着2ペアを意味しない。
experimental優位を示す成績ではない。異なる対局経路で深さや評価値を単純に棋力比較しない。

|方式|保存手数|API合計ms|完了深さ0 / 1 / 2 / 3|partial-root|fallback|
|---|---:|---:|---|---:|---:|
|legacy|197|197,285.883|33 / 133 / 28 / 3|33|0|
|experimental|197|197,293.136|40 / 125 / 29 / 3|40|0|

API合計394,579.019ms。開始行・手・終了行の保存/fsync合計2,952.217ms、終了行までの対局全体合計439,192.999ms、プロセス起動終了込み440,700.410ms、監督run全体440,722.072ms（約7分21秒）。保存以外の約41.7秒は合法手/PV検証、入力保護、全状態hash等を含むハーネス処理で、探索API費用へ混ぜない。4局のjournal合計2,269,905 bytes。各上限とrun上限の内側で終了した。詳細の各局値はsummary.jsonとsupervisor.jsonlに保持する。

旧PR #214は同じ開始局面・探索設定の1000ms平手1ペアが両局120ply打切り、棋譜由来ペアが全体15分上限で未保存/未完了だった。今回はその2ペアをすべて新規測定した。旧matrixの性能・有限参照評価は再実行していない。ハーネスの手ごとのfsync/再生検証/clone/hash、別実行時のOS/JIT変動、異なる対局経路があるため、旧rawとの差を純粋な評価変更の因果効果や棋力改善・悪化率とは解釈しない。係数調整も既定ON化も行わない。

## 再集計・原本保護・検証

- 2回のplan付き監査、planなしのjournal単独監査（同じjournalを1つ重複入力）のsummaryとreportはbyte一致。summary SHA256は `4db95af66c2ba52350e539e32fa709bae6ae3c8a3d144074ab06ed5154eb0134`、reportは `1718bdc72316c342fc91b8e44cf2761e10d8de9ae9ffc885ba0b614e47071094`。再集計前後の5原本（4局＋監督log）hash不変。検査記録はvalidation/reaggregation-verification.json。
- journal回帰33件：正常詰みとInfinity、決定的互換、任意停止、実プロセスSIGKILL後3手、末尾断片、中間破損/欠落/重複/逆転/未知schema、不正値、実際の閉じたfdへの書込み失敗後1手、fsync失敗、short/zero write、容量、0ms/途中時間上限、探索失敗、重複/衝突/片側ペア、再集計一致、初期履歴を検証。故障を注入した原本はfault-fixtures-*、最終採用実装の型検査・回帰はvalidation/journal-provenance-fix.log等。故障fixtureの件数を本測定4局の破損0と混同しない。
- 測定前の全体91ファイル2466件、関連4ファイル128件、lock・型検査（lint）・production build成功。製品のソース変更は0。初回sandbox起動/型エラー/prepare拒否はsetup-failures.jsonと原ログに残す。npm ciのローカル再実行とmacOS固有検査は行っていない。CIのclean install/OS検証は最終HEADについてPR本文に記録する。
- 既存1087証拠と測定ソースgzipはsealで照合する。新規証拠manifestには原本・故障原本・ログ・計画・ソースsnapshot・再集計・本書を含む。最終HEAD/CIは自己参照を避けDraft PR本文に記載し、人間の独立レビュー待ちで停止する。
- 測定後の最終型検査・全体91ファイル2466件・production build（1762 modules）も成功。validation/lint-final.log、full-tests-final.log、build-final.logに保存。全体ログの既存jsdom navigation警告は原文のまま保持する。旧1087原本と測定ソースの最終照合はvalidation/originals-final.jsonで成功。
