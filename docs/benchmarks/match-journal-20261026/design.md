# 対局journal：実装前の設計と固定条件

Issue #215 / PR #214。基準はfetch済みmain `4009cd0e808553af8f0ec9e01411a3eb6714560d`。
クリーンなmainをfast-forward確認後、`codex/match-journal-1000ms` を作成した。
リポジトリと親ディレクトリにAGENTS.mdファイルはなく、依頼文の「回答末尾に日時」を適用する。
PR #214のマージと独立レビュー（2026-10-26、限定PASS）を確認。同目的Issue #215を使用し、本文は変更しない。

## 記録形式と保証

対局ごとに新規JSONLをexclusive create (`wx`)。追記専用、再開・原本修復・切詰めはしない。
各行はschema=1、0起点seq、前行SHA256、payload、当該行のSHA256を持つ。
payloadは型付き値の再帰表現（null/undefined/boolean/string/number/array/object）。
数値のInfinity、-Infinity、-0を専用表現にし、NaNは拒否する。普通の文字列と混同しない。
objectはソートしたキーと値の組で、未取得プロパティとnull、欠落プロパティも区別する。
UTF-8・LF終端の完全な行のみ確定記録。末尾のLFなし断片は検出し、その前まで監査する。
改行で終わる不正行、途中の破損・欠落・重複・順序逆転、未知schemaは監査失敗。
末尾断片がある対局は正式比較から除外する。原本の改変防止ではなく偶発破損検出であり、署名ではない。

開始行：run/pair/game ID、ソースcommitとソースhash、実験条件、先後対応、完全BoardState（初期局面・棋譜・反復履歴を含む）、開始時刻、環境、時間/深さ/手数/容量上限。
手の行：連番、対局内ply、盤面moveNumber、手番、合法手、探索APIの呼出し時間、全探索結果（PV/評価内訳/完了深さ/source/統計を含む）、適用後の全状態hash。
終了行：規則終局・手数打切り・時間上限・任意停止・探索失敗・容量停止を区別し、最終状態と結果、API合計/保存合計/全体経過時間を保存する。
終了行そのものの保存時間は同じ行に自己記録できないため、終了までの保存時間と終了行書込みを含むsupervisor計測を分ける。

各行はshort writeを処理する同期writeループ後にfsyncする。これが戻るまで次の探索を呼ばない。
探索API時間にjournal/flushを含めず、対局全体経過には含める。親のメモリやIPCだけに依存しない。
IO失敗時は即停止し、終了行が書けることは前提にしない。親側の新規監督ログへ失敗を記録する。
容量は対局ごとに上限と終了用reserveを設ける。容量拒否は次の探索へ進まず停止。
ハードkill・電源断・媒体故障では終了行を保証しない。fsync済み記録のプロセスkill耐性を検証し、電源断耐性は主張しない。
開始前のexclusive lockで同一run再実行を拒否。別run ID・別ディレクトリでやり直す。

## 既存規則の再利用と監査

scripts内adapterから既存runSelfPlayGameをmaxPlies=1で呼び、返却stateを次へ渡す。
この既存APIが行う探索入力保護・合法手照合・観測値検証・適用・終局判定を再利用する。
監査も保存した探索結果を注入して同じ合法手API経路で1手ずつ再生し、PV葉の評価内訳を既存評価APIで照合する。
初期履歴は保存した初期snapshotと棋譜（既存BoardStateのpositionSnapshots/history）から既存APIで再構築して照合する。
終局行も再生stateと規則結果を照合。欠けた終了行は規則終局に見えても未完了とする。
summary/reportは原本journalだけで再生成できる。予定一覧を渡すと未実行も数えられる。
同じgame identityの同じ原本は一度だけ数え、異なる内容の同identityは衝突として拒否する。
ペアは同一run/pair・開始局面・条件・source・先後交換を検証し、2局の終了と監査がそろったものだけ正式ペアに数える。

## 測定前に固定する1000ms条件

PR #214 run2/plan.jsonの平手と6手合法棋譜由来の完全stateをコピーし、同一性を検査する。
各1ペア（legacy先手/experimental後手、experimental先手/legacy後手）、計4局を新規runで直列実行。
1手1000ms、max depth 4、120ply、standard評価/通常standard、q depth 1/original、
quiet promotions OFF、check evasion extensions 0、TT/PV/killer OFF。前回と同じ。
対局単位でソフト290秒・親ハード300秒、全体22分、各journal上限16MiB（終了reserve64KiB）、合計最大64MiB＋小さい計画/監督記録。
旧15分をmatrix等と共有する方式から対局専用予算へ変更。棋力条件は変えない。
テスト・build・他性能測定と並行しない。旧runを継ぎ足さず、係数調整・既定変更なし。
完了は規則終局または120ply到達＋終了行＋監査成功。手数打切りは引分ではない。

## 受入検証

正常終局、任意手数停止、実プロセス強制終了、末尾途中切断、中間破損/欠落/重複/逆転、未知schema/不正値、非有限値往復、IO/fsync失敗/short write/容量/時間上限、重複入力/identity衝突、片側ペア、2回再集計と原本不変、決定的fixtureのjournal有無互換を検証する。
関連テスト→全体回帰/型検査/build→1000ms測定→監査/再集計2回→最終チェックの順。
既存証拠は開始時と終了時のSHA256で照合し、新成果物にもmanifestを作る。
棋力の一般的向上はこの2ペアから結論しない。ピン・合法取り返し・深い独立参照は次段階。
