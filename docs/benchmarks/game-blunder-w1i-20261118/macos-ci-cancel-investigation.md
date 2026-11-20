# Stage W1i macOS CI キャンセル原因隔離（読取専用）

## 固定対象・結論
PR #218、固定HEAD `b1132523fbd82e603877e153846d6ff20e8fcc3f`、正式run [44337930402](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44337930402) / macOS job [134919598366](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44337930402/job/134919598366)。

**OBSERVED:** run completed/failure、Ubuntu SUCCESS、macOS completed/cancelled、steps=0、runner_name空文字。根本原因 **UNKNOWN**、最も整合する故障層はGitHub-hosted macOS runnerの割当/起動段階。製品コード・Vitestテストの実行失敗は観測されていない。ジョブにステップがないことから「テストが成功した」とも主張しない。

## 時系列と反例
| run | HEAD | macOS開始UTC | macOS終了UTC | 結果 | runner_name | steps |
|---|---|---|---|---|---|---|
| [44337930402](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44337930402) | `b1132523` | 2026-11-18 15:38:15 | 15:53:19 | cancelled | 空欄 | 0 |
| [44325462274](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44325462274) | `ec8fc6fb` | 2026-11-18 14:32:59 | 14:48:00 | cancelled | 空欄 | 0 |
| [44333269727](https://github.com/tetsujisugimori-coder/Shogi-App/actions/runs/44333269727) | `1b4b17d9` | 2026-11-18 15:21:12 | 15:24:10 | success | GitHub Actions 1000023997 | 13 |

該当2キャンセルの約15分という時間幅、実行ステップ0、ランナー名なしが共通している。Ubuntuは対象runでSUCCESS。専用CI #44337935698もSUCCESS。実行jobのステップや原ログは取得できず、従来の404 BlobNotFoundも記録済み。

`.github/workflows/ci.yml` のOS matrixは `ubuntu-latest` と `macos-latest`、`fail-fast: false`、`concurrency` と `timeout-minutes` の指定なし。通常のmatrix fail-fast、テストtimeout、製品コード修正に原因を決め打ちしない。

GitHub check-run一覧では当該macOSにannotationが4件存在するが、利用できるGitHub接続経由では個別annotation本文取得不可。キャンセル要求主体・GitHub側の正式理由は未確認、再現性や根本原因もUNKNOWN。一般の類似報告 [GitHub community #211885](https://github.com/orgs/community/discussions/211885) と [#212069](https://github.com/orgs/community/discussions/212069) は参考であり、本runの原因証明ではない。

## 隔離判定と次の確認
- **JOB_SETUP_OR_RUNNER_ASSIGNMENT_SUSPECTED / CAUSE_UNKNOWN**。ソース・lock・Node設定・製品テストを変更する根拠なし。
- 独立担当が権限のあるGitHub UI/APIからjob annotation 4件の本文（runner capacity、acquisition failureなど）を読める場合に限って確認する。利用不能ならUNKNOWN維持。
- 必要性を判断した後でのみ、同一コミットのキャンセルされたmacOS jobを1回再実行し、runner名・steps・実測とrun attemptを保存する。今回の調査では手動再実行なし。
- 保存302件の限定PASS、比較BLOCKED、旧0／新0、S4/S5 NOT_TESTED、R8/H1〜H4 UNKNOWN、Draft維持・マージNOは変更しない。
