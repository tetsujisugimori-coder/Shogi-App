# exact限定Transposition Table（2026-10-21 JST）

基準はorigin/main `519a332c36ad97dacdaae8c09a20a8e08bf511be`（PR #194）。PR #190 / #192 / #194のMERGEDと各merge SHAをGitHubで確認し、元mainの未コミット変更なし・既存worktree一覧を確認後、専用 `codex/transposition-table` / 独立worktreeで実装した。既存診断原本は変更しない。mainへコミット・マージしない。

## 公開設定と所有期間

`AlphaBetaSearchOptions.useTranspositionTable: true` のみ有効。未指定/falseは既定OFF。各公開探索APIで新しいtableを生成し、同じ呼出し内の反復深化で共有する。別呼出し・Worker・UI・棋譜保存・グローバル状態に追加しない。`createTranspositionTableStatistics()` の返り値を `transpositionTableStatistics` に渡すと、呼出し全体（中断した反復を含む）の観測を取得できる。既存の公開探索結果へフィールドは追加しない。

```ts
const statistics = createTranspositionTableStatistics();
const result = analyzeIterativeDeepeningAlphaBetaSearch(state, 4, undefined, undefined, {
  useTranspositionTable: true,
  transpositionTableStatistics: statistics,
  killerMoves: false,
  usePreviousIterationPv: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' },
});
```

## 同一性と安全性

- 粗い検索キーは既存positionKey（盤面/持ち駒数/手番）＋remainingDepth＋rootからのply。完全な文字列を比較し、ハッシュ衝突を許容しない。深い結果の浅い探索への流用、異なるplyへの距離変換はしない。
- 採用前に盤上の駒情報（IDを含む）、順序付き両持ち駒、手番/status/result、moveNumber、moveLimitJishogi保留状態、history.length、root視点/maximizing、静止探索設定、通常順序、当該経路の残りPVヒントを照合する。評価設定は呼出しに固定され、tableは別呼出しへ持ち越さない。
- 履歴を区別しないのは、終局済み・追加着手0、または `max(1, 過去の最大同一キー出現回数) + remainingDepth + qDepth < 4` の場合だけ。合法着手1回につきpositionHistoryへ追加する記録は最大1件なので、どの後続キーについても4回目へ到達できない。qはchecked時の全回避も含め追加上限で数える。これは最短循環長に依存しない、意図的に弱い上界である。
- それ以外はpositionHistory全体（順序、movedBy、gaveCheck、historyIndex）を完全一致で要求する。異経路の履歴は通常一致せず、再利用を拒否する。正規化で履歴がリセットされる入力にも推測の履歴は補わない。
- 千日手が起こらない範囲でも500手規定はmoveNumberと保留状態に依存するため、常に区別する。勝敗距離は同じroot plyだけを再利用する。
- 同じ棋種の駒ID・持ち駒順を変える再利用は拒否する。PV内のdrop IDを別IDへ変換しない。
- killerMoves有効時は、内部履歴の副作用を再現できないので値再利用・保存とも行わない。PV優先は当該経路のヒントsuffixまで一致する場合のみ利用できる。

## exactの証明と期限

通常のalpha-beta値は部分木のfail-high/fail-lowを含む。既存のpartial-rootは深さ1の候補と期限承認に特化したexact条件であり、TTの保存判定へ流用しない。

TTはstatic/終局/合法手なしの直接評価をexactとする。q結果は子孫全体のcutoffCountが0のときのみexactとする（stand-patによる全候補省略もcutoffへ含まれる）。通常ノードは全子がこの意味でexactで、かつ未探索手を残すcutoffがないときだけexactとする。数値と窓端の大小・一致からはexactへ昇格させない。最終手で窓が閉じても、全子がexactで全候補を探索済みなら完全なmin/maxである。この方式は真にexactな通常alpha-beta結果も多く捨てるが、boundの伝播を積極利用しない。

ノード進入時の既存中断確認をTT probeの前に実行し、時計読取り位置・回数を追加しない。中断例外で戻らなかったノードは保存しない。中断前に完了した子ノードの保存件数は観測へ残るが、中断後は探索呼出しとともにtableを破棄する。最深完了反復、期限承認済みexact partial-root、既存fallbackの優先順位は変更しない。NaN/RangeErrorは従来どおり伝播する。

SearchValue・PV・評価内訳を一体で複製して保存・再利用する。訪問ノードは従来どおり実際に適用した着手を数え、hitに到達する着手は数えるが、省略した子孫は加算しない。qのleaf/visited/cutoffも実際に実行した分だけ数える。

## 容量と観測の定義

512件FIFO。hitで順位を変更しない。同じ粗いキーの置換は末尾に移す。1件のkey＋安全性identity＋結果のJSON文字数を16,384文字以下に制限し、大きい履歴/PVは保存しない。保持文字列・結果の表現は最大8,388,608文字（UTF-16換算約16MiB）に制限する。Map/オブジェクト/allocatorの追加費用や一時生成文字列、呼出し全体のRSSをこの数字で保証しない。512件は長い履歴を含む初期実装の費用を抑える保守的な選択であり、最適容量とはしない。

`lookups = hits + misses`。hitsは粗いキーが存在した件数で、exactReusesは安全性identityまで一致して探索を省略した件数。safetyRejectsはidentity不一致・killer迂回・非exact保存拒否・サイズ超過保存拒否を含み、missesとは別軸。storesは完了exact結果の挿入/置換回数、evictionsは容量によるFIFO追い出し、maxEntries/maxPayloadCharactersは実測最大。既存通常/q統計は最深完了反復、total系は完了反復の合計という意味を維持する。

## 再現

Node 24 / npm 11、同じlockfileで `npm ci`。測定中は重いプロセス・テスト・buildを並走させない。

```powershell
npm run check
node --import tsx scripts/audit-transposition-table.ts reference docs/benchmarks/transposition-table-20261021/reference.json C:/Users/tetsu/Documents/Codex/Shogi-App
node --import tsx scripts/measure-transposition-table.ts docs/benchmarks/transposition-table-20261021/run1
node --import tsx scripts/audit-transposition-table.ts summary docs/benchmarks/transposition-table-20261021/run1
```

既存出力を上書きしない。referenceの最終引数には基準SHAのclean checkoutを指定する。完全入力、環境、設定、実行順、測定HEAD/dirty差分、測定ソースSHA-256とgzip原本はrunのplan/sourcesへ保存する。rawはInfinityを保持する既存json/parse形式。summaryはrawから再計算し、既存summaryがあれば完全一致を要求する。測定コードと診断集計のbytesも監査する。

## 検証結果

- 基準mainの通常checkは再実行で77ファイル/2,055件、lockfile・型・buildすべて成功。初回の共有依存junctionを使った試行は出力が止まり対象テストプロセスのみ終了した（原因未確定）。独立依存の初回checkは既存の詰み探索1件が5秒timeout、他2,054件成功。再実行はtimeoutなしで成功した。未接続の追加診断スクリプトを基準型検査へ混ぜた1回の型エラーも別ログへ保存し、基準検証では外した。
- 新規TTテスト初回は18成功/2失敗。千日手用fixtureが先に詰みになる不備を、王手しても詰まない飛車局面/両玉局面へ修正した。修正後の関連4ファイル95件は成功。その後の製品版通常checkは78ファイル/2,075件、lockfile・型・production build（1,761 modules）すべて成功。
- 回帰はFIFO/文字量上限、履歴差・連続王手、500手境界/保留状態、勝ち最短/負け最長、ply/depth分離、ID/持ち駒順、PV合法性/葉評価、root元index、qあり/なし、普通/q cutoffを含む全保存部分木の独立再評価、PV/killer併用、制御時計のpartial/fallback/完了反復優先、hit中の期限、NaN拒否を含む。非終局±Infinityの実再利用と同じ公開呼出しの反復による非共有検査を追加した最終22件も成功。
- 実mainとのOFFは12局面×d1〜4の48件で、選択手・評価内訳・全PV・全既存統計が完全一致（時計を0固定）。独立全幅・逆順全幅の44条件とTT ONを照合。全12局面のd1通常/d1q1/d2q1、さらに小規模4局面のd4通常/d4q1を含む。全12局面d4の全幅証明を実施したという主張はしない。
- 実際に異なる合法経路から到達する両玉局面でhitとq leaf省略を確認し、独立全幅と照合。全保存部分木の値を独立参照と照合する検査も成功した。
- 最終通常checkは **78ファイル/2,077件、lockfile・型検査・production buildすべて成功**。ログは `validation/final-check.txt.gz`。既存timeout/worker数/アサーションは変更しない。Ubuntu/macOS CIと最終HEAD/PR headの一致はPR本文へ確定記録する。

## 今回の測定

2026-10-21 **08:49:19〜09:02:43 JST**。Windows 10.0.26300 x64 / Intel Core i7-14650HX / Node v24.20.0 / npm 11.17.0。実環境の正確な識別はrun1/plan.jsonを参照。standard評価・standard順序・killer=false・PV優先=false・q original+1・最大d4。固定d4単発、無期限反復d1〜4、100ms、1,000msの4条件。12局面を除外せず、各条件1組warmup後3組、OFF/ON順を毎組反転して同期直列実行した。テスト/build/独立参照との並走なし。

384呼出し＝warmup96＋本測定288。例外・失敗・欠測0。生データは `run1/raw.jsonl.gz`、SHA-256（展開後）は `14ea7192257ea4b67ba50ccfa76388eaebf6ca5f88312d7c2d94c939b001bf11`。全入力/測定時SHA/dirty差分/ソースhashとgzip原本はplan/sourcesへ保存。測定時HEADは基準mainであり、測定実装の識別は差分と原本bytesによる。最終製品bytesとの一致はauditで確認した。

`summary.json` のノード合計は本測定3回の合計。以下の通常/qノードだけは、決定的に同じ結果となった各局面1回分の12局面合計へ換算する。時限のp50/p95は各36標本を同じ比率でプールした値で、局面別3回のp95は最大値となる。統計的な有意差や一般棋力を推定しない。

| 条件 | 通常ノード OFF→ON | qノード OFF→ON | 実時間p50 OFF→ON ms | 実時間p95 OFF→ON ms | exact値再利用（本測定3回合計） |
| --- | ---: | ---: | ---: | ---: | ---: |
| 固定d4単発 | 30,978→30,922（−0.18%） | 11,562→9,425（−18.48%） | 440.038→435.947 | 18,721.498→18,884.621 | 10,359 |
| 無期限反復d1〜4の合計 | 38,832→38,726（−0.27%） | 10,895→9,032（−17.10%） | 571.180→557.624 | 23,793.581→23,908.679 | 16,086 |
| 100ms | 完了反復の統計をraw/summaryへ保存 | 同左 | 100.446→100.566 | 102.999→102.722 | 186 |
| 1,000ms | 完了反復の統計をraw/summaryへ保存 | 同左 | 591.816→566.585 | 1,001.502→1,001.373 | 4,101 |

無期限反復の最深d4だけなら通常26,539→26,435、q9,529→7,694。固定単発と反復では既存root順序が違うため、同じ深さ4でも仕事量を混同しない。時限の通常/q統計は既存の定義どおり完了反復だけを含み、TT統計は中断した反復も含む。時限の完了ノード数を呼出し全体の実作業量と解釈しない。

本測定のTT観測合計はlookup **236,371**、粗いhit **30,978**、安全なexact再利用 **30,732**、miss **205,393**、安全性拒否（保存拒否を含む） **107,244**、保存 **98,565**、eviction **60,628**。粗いhitのうち246件は安全性identity不一致で採用しなかった。最大保持 **512件**、最大payload表現 **2,357,618文字**（UTF-16約4.50MiB相当、追加オブジェクト費用/一時領域/RSSは別）。省略された子孫ノードを訪問数へ加算しない。

| 時限 | 完了深さ分布 OFF→ON（各36標本） | resultSource OFF/ON | 最大超過 OFF→ON ms |
| --- | --- | --- | ---: |
| 100ms | d0:9→9 / d1:6→6 / d2:11→12 / d3:10→9 / d4:0→0 | 両方 completed27 / partial9 / fallback0 | 3.776→3.144 |
| 1,000ms | d2:9→9 / d3:6→6 / d4:21→21 | 両方 completed36 | 1.800→2.084 |

全384件のPV合法再生・末端内訳一致、固定/無期限ON/OFFの選択手・公開評価・終局距離を監査。固定/無期限のPV差は0件。時限の完了反復は同設定の無期限反復へ全統計を含め照合した。partial-rootはwarmupを含め24件（本測定18件）の選択候補を独立qで再評価し一致。実測fallbackは0で、制御時計のfallback回帰と区別する。

### 局面別の実時間と仕事量


| 局面 | 固定d4 p50 OFF→ON ms | 固定 通常/q OFF→ON | 反復d1〜4 p50 OFF→ON ms |
| --- | ---: | --- | ---: |
| mate-sente | 7933.631→7897.438 | 通常7168→7159 / q3507→2876 | 10569.235→10186.603 |
| mate-gote | 9125.017→9323.699 | 通常8863→8853 / q2155→1778 | 11039.084→11133.700 |
| mate-three | 87.413→92.304 | 通常158→158 / q0→0 | 187.071→193.615 |
| mixed-distance | 140.010→142.460 | 通常240→238 / q0→0 | 288.539→298.101 |
| resistance | 159.439→163.942 | 通常312→312 / q24→23 | 202.054→201.352 |
| evasion | 433.644→429.313 | 通常693→675 / q110→110 | 565.852→543.596 |
| recapture | 1836.796→1983.819 | 通常2667→2667 / q194→191 | 1860.311→1818.290 |
| capture | 483.272→488.847 | 通常715→715 / q23→20 | 885.542→853.255 |
| recapture-gote | 1150.969→1154.307 | 通常1560→1556 / q270→198 | 1642.400→1635.477 |
| hirate-exchange | 18721.498→18884.621 | 通常7913→7913 / q5181→4133 | 23793.581→23908.679 |
| terminal-resistance | 225.066→232.831 | 通常407→394 / q60→58 | 282.270→281.583 |
| terminal-resistance-gote | 180.328→188.064 | 通常282→282 / q38→38 | 230.081→236.947 |

## 判断と制約

**B：安全だが効果は限定的・条件付き。既定OFFを継続し、既定ONは推奨しない。** exact限定の値再利用と独立参照の一致を確認し、qノードを約17〜18%削減した。一方、通常ノードの削減は0.2〜0.3%程度に留まる。固定単発のp50は12局面中10局面で悪化（recapture +8.00%、mate-three +5.60%等）、反復では7局面で短縮・5局面で悪化した。プールp50の短縮だけで速度改善を一般化しない。100msの深さ3完了が1標本減り、1,000msの深さ分布は不変、最大超過は増えた。

容量/文字数制限、履歴一致、all-descendants exact条件により多くの結果を捨てる。q深さや通常深さが増えるほど履歴を省ける範囲は狭くなる。長い履歴はサイズ超過でも保存拒否となる。深さ＋ply一致を要求するので、別反復で同じ深さ条件が成立する機会も限定される。killer併用ではTTを迂回する。局面キー生成、履歴走査、JSON同一性生成・複製が費用となり、再利用しても静的葉評価だけを省くhitでは通常/qの着手ノードが減らない場合もある。

OS/JIT/GC/電力/affinityを固定せず、3組/条件の探索的観測である。厳密な100ms復帰、CPU費用単独の改善、一般棋力、RSS上限、長期対局や深い探索での効果を保証しない。期限をまたぐ単一同期処理は従来どおり次の確認まで継続する。未解決の正当性不一致は検出されていないが、全将棋局面の完全証明ではない。

次候補は、履歴安全性を保つ同一性生成の費用削減、再利用で実際に減った評価/着手工程の分離計測、容量の感度分析と多回測定、子boundの区間を明示して親exactを証明する保存範囲拡大、killer副作用を扱う設計。bound値の積極的再利用・ply変換・永続共有・既定ONは別PRで判断する。

証拠フォルダーの `.gitattributes` は改行変換を止めて採取bytesを保存する。新規cloneからhashを照合するときはソースのLFも維持する（例: `git -c core.autocrlf=false clone ...`）。`audit ... summary` はrawの圧縮前/後の両形式に対応し、`audit ... manifest` は保存物と最終ソースのSHA-256を再検証する。CI確定状態と最終commitはPR本文に記録する。

採取stdout/stderrの原本は `validation/*.txt.gz` にbytesを変えず保存する。gzipは標準ツールで展開できる。新規メタデータの改行はLFとした。
