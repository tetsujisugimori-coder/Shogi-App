# TT 2段階照合（2026-10-21 JST）

## 実装前の設計判断

基準main: `f5fdb17c777f34e4db34d903135f6a5dc88e93c9`。GitHub fetch後、PR #196がMERGED、最終実装 `ae8fae547064ff0364a0bb149654e41d7fe71a11`、merge commitが上記mainであることを確認した。元checkoutはclean。branch/worktree一覧を確認し、既存の診断原本とworktreeは変更しない。専用 `codex/tt-two-stage` / `.worktrees/tt-two-stage` を作成した。

README、LOG、PR #196の診断資料、TT/search/test/measure/auditを確認した。公開探索APIの既定OFF・呼出し内所有・opt-in検証・全子exactという保守的保存条件を維持する。

`has→probe` はmiss時の生成を省けるが、hit時にMapを2回検索し、候補確認と厳密照合を別APIに分散する。既存 `probe(key, string)` を維持しつつ `string | (() => string)` を受ける方式を選ぶ。Map.getは1回、候補なしならコールバックを実行しない。呼出し側でidentityをメモ化し、hitの照合済み文字列をexact保存に再使用する。miss後に非exactなら生成せず、exactなら保存直前に1回生成する。コールバック/メモ化の小さい費用は実測対象とする。

厳密identityのbytes、比較、root/ply/depth、履歴上界と全履歴、駒ID/持ち駒順、500手保留、PVヒント、評価/距離/PV複製、killer迂回、FIFO/文字数制限は変更しない。既存中断確認の後にprobeし、時計呼出しを追加しない。hashによる同一性判定は行わない。exact以外の値を保存・再利用しない。

既存統計の意味は維持し、新規カウンターでidentity生成、identity一致/不一致、非exact拒否、サイズ拒否を分離する。時間の細分化は通常経路へ時計を追加せず、診断でprototypeラップによってA key/B identity/C probe（Bを含む）/D store用複製（store直前の残余）/E store（容量判定・JSON・Map操作込み）を測る。工程を完全分離できない場合は包含関係を明記する。Fは同条件OFFとのノード・qノード差で観測する。通常測定と診断測定を区別する。

## 比較計画

A=固定main TT OFF、B=同main TT ON、C=改善TT ONを同一processで同期直列実行。旧12局面、fixed d4、無期限d1〜4、100/1000ms（最大d4）、小規模局面d5、長い履歴を追加する。各セルwarmup1回＋本測定3回、ABC/BCA/CAB順をローテーションする。深い探索の事前費用をprobeで確認する。生データ、完全state、設定、ソース原本/hash、環境、測定時SHA/diffを保存する。過去の時間値を流用しない。テスト/build/独立参照を測定と並走させない。

決定的OFF→旧main、旧ON→新ONは経過時間以外の結果/ノード/PV/終局距離/既存TT統計を比較する。時限は完了深さとsourceを分離し、完了反復を同設定の無期限探索と比較する。制御時計による期限/partial/fallbackと独立全幅比較も行う。rawからsummaryを再計算し既存summary一致を要求する。
