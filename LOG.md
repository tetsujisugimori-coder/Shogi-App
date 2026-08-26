# SHOGI-APP 開発ログ

## [2026-08-26] 将棋研究 初期画面（平手初期局面表示）の実装

### 概要
将来のローカルAI対局・棋譜保存・エンジン解析・AI同士の観戦演出の基盤として、平手初期局面を正確に表示する将棋盤UIおよび将棋研究画面を実装しました。

### 実装内容
1. **データ設計 (`src/types/shogi.ts`)**:
   - `Player` (`sente` / `gote`)
   - `PieceType` (`king`, `rook`, `bishop`, `gold`, `silver`, `knight`, `lance`, `pawn`)
   - `Piece`, `BoardSquare`, `BoardState`, `BoardStatus`, `TableViewMode`
   - 平手初期局面生成関数 `createInitialBoardState()`
   - スクリーンリーダー用ARIAラベル生成関数 `getSquareAriaLabel()` (例：「5筋 1段、後手の玉将」「7筋 7段、先手の歩兵」「4筋 5段、空のマス」)

2. **駒コンポーネント (`src/components/shogi/Piece.tsx`)**:
   - CSS `clip-path` による実物に近い伝統的五角形形状
   - 木質感シミュレーション（温かみのある木色グラデーション、木目テクスチャ、立体感のある光彩・シャドウ）
   - 日本語駒文字の明瞭表示（先手は正位置、後手は180度回転）
   - 先手「王」、後手「玉」および金、銀、桂、香、飛、角、歩の正確な配置
   - 将来の成駒・移動アニメーション・選択状態のための `data-*` 属性設計

3. **将棋盤コンポーネント (`src/components/shogi/ShogiBoard.tsx`)**:
   - 9×9 正方形グリッド
   - 榧（かや）調の高級感ある飴色〜木色グラデーションと面取り立体フレーム
   - 自然な濃茶色の繊細な罫線
   - 4隅の星（星印・黒漆ドット: 7-3, 3-3, 7-7, 3-7交点）
   - 外周座標（筋: 9〜1、段: 一〜九）
   - 状態別クラス（通常、王手、大悪手、AI評価中等への拡張性）

4. **駒台コンポーネント (`src/components/shogi/PieceStand.tsx`)**:
   - 上側：後手の持ち駒台（「後手の持ち駒」表示）
   - 下側：先手の持ち駒台（「先手の持ち駒」表示）
   - 高級木製駒台の意匠と将来の駒配置スロット

5. **対局卓コンテナ (`src/components/shogi/ShogiTable.tsx`)**:
   - 暗めの研究机（ダークウォールナット・スレート質感）の背景
   - 先手側から少し見下ろす2.5D研究パースペクティブ（CSS perspective & rotateX）
   - 将来のプレイヤーアバター、対戦情報パネル、観戦モード（`data-view="research"` / `spectator`）用スロット構造

6. **将棋研究画面 (`src/components/shogi/ShogiResearchScreen.tsx`) & 導線 (`src/components/layout/AppHeader.tsx`, `src/App.tsx`)**:
   - タイトル「将棋研究」
   - 説明文「AIとの対局・棋譜・判断ログを記録する研究画面です。」
   - ステータスバッジ「準備中 / 先手番」
   - 下部案内文「盤面表示の初期実装です。駒移動・対局機能は準備中です。」
   - Memo-Nexus ヘッダーからの画面遷移導線

### 検証
- TypeScript型チェック (`npm run lint` / `tsc --noEmit`): エラーなし
- ビルド検証 (`npm run build`): 正常完了

## [2026-08-26] 駒・将棋盤のリアル路線（3D立体木質感・2文字毛筆書体）への刷新

### 概要
添付のリアル調将棋盤・駒の画像に合わせ、本黄楊（ほんつげ）の彫駒、3D側面の厚み・影、2文字伝統書体（玉将、金将、銀将、桂馬、香車、歩兵、飛車、角行）、重厚な榧（かや）盤の木目とリムライト、木製トレイ型駒台への質感向上を実施しました。

### 実装内容
1. **駒のリアル3D彫駒化 (`src/components/shogi/Piece.tsx`)**:
   - 本黄楊（Tsuge）の温かい蜂蜜色グラデーションと柾目木目テクスチャ
   - 盤上に落ちる方向性リアルドロップシャドウと側面の厚み（木口・厚みレイヤー）
   - 上部エッジの面取り光反射（Top Bevel Highlight）
   - 添付画像に準拠した2文字縦並び毛筆書体（`Shippori Mincho`, `Yuji Boku`, `Noto Serif JP`）
   - 駒種ごとの精密なプロポーション比率（王/玉 > 飛/角 > 金/銀 > 桂/香 > 歩）
2. **将棋盤のリアル厚盤化 (`src/components/shogi/ShogiBoard.tsx`)**:
   - 日向榧調の重厚な天面木目、極細の漆目罫線、星印（4交点）
   - 盤手前側の木口（年輪・側面立体ブロック）の3D表現
   - 添付画像と一致する上部エッジの温かいオレンジ〜レッドのリムライト発光
3. **高級桑調 駒台 (`src/components/shogi/PieceStand.tsx`)**:
   - 枠付きの脚付き木製トレイ構造
   - 天面凹みと深みのあるダークウォールナット/桑の質感
4. **対局卓のスタジオライティング (`src/components/shogi/ShogiTable.tsx`)**:
   - 上下中央に駒台を配置し、ダークマットな机の上にスポットライトが当たる落ち着いた構図

## [2026-08-26] アプリタイトルの変更（SHOGI-APP）
- アプリケーション名称を「SHOGI-APP」に更新（`metadata.json`, `index.html`, `AppHeader.tsx`, `LOG.md`）

