# 安全条件と検証対応

製品変更の範囲はTTのprobe引数の遅延評価、search内のmemoization、追加観測カウンターのみ。exactの証明、履歴identityの内容、結果複製、探索・評価・合法手・ルール・期限/partial/fallbackの実装は維持する。

| 条件 | 検証 |
| --- | --- |
| 既定OFF、opt-in、呼出し間非共有 | 既存TT回帰＋103条件referenceのmain-OFF/新OFF完全一致48件 |
| exact限定、bound禁止、q cutoff | 全保存部分木の独立全幅照合を含む既存TT回帰 |
| rootPlayer/maximizing、ply/depth | identity bytes不変、既存ply/depth分離回帰、先後反転の全幅比較 |
| 駒ID、持ち駒順 | 粗いキー一致でもidentity不一致となる既存回帰 |
| 千日手、連続王手 | 完全順序付き履歴/履歴上界の既存回帰＋実際の終局実行 |
| 500手と保留状態 | 498/499/500各境界、pendingあり/なしと全幅比較 |
| 勝ち最短、負け最長、終局理由/距離 | 小規模4局面d4/q有無の独立全幅・逆順全幅、全測定PV合法再生 |
| PV、評価内訳 | 全参照・測定で合法PVを実行し葉の内訳/評価/距離を再照合 |
| killerMoves、PV併用 | 既存回帰＋旧新のPV/killer 4組の反復全結果一致 |
| 中断位置、期限、partial/fallback優先 | 時計位置の差分確認、既存制御時計・hit期限回帰、旧新7予算の制御時計全結果一致 |
| NaN/RangeError、非終局Infinity | 既存NaN拒否・±Infinity実hit回帰、通常checkの全既存例外回帰 |
| FIFO、保持件数/文字数 | 既存FIFO/過大entry回帰＋全測定の上限/既存統計照合 |
| 候補なしで生成しない | lazy callback単体回帰＋実探索の生成/保存/拒否統計回帰 |
| identity不一致拒否、保存時再使用 | 強制coarse衝突でpoison値を拒否し、exact保存が同じidentityを再使用する新規回帰 |
| exact保存時生成、非exact時省略 | 新規実探索回帰（生成数、hit、store、nonexact拒否の関係） |
| 長い棋譜、深い探索 | 合法120手再生を全stateごと保存、d4/反復/時限、代表3局面d5のABC比較と監査 |

reference.json.gzの103条件 = main OFF/旧ON対新ON 48 + 独立全幅44 + PV/killer4 + 制御時計7。全幅の44条件は各12局面のd1/qなし、d1/q1、d2/q1と、小規模4局面のd4/qなし・q1。全12局面のd4全幅証明ではない。各全幅参照を逆順の全幅とも照合した。

最初の関連テスト試行はsandbox Temp rename EPERMでテスト0件、同じ設定の通常権限で再実行後24件成功。追加memoization回帰後25件成功。timeout、worker数、期待値、assertionの緩和なし。README追記の最初のPython試行はWindows既定cp932による読取りエラーで未変更、UTF-8明示で再実行した。
