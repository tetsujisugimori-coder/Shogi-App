# 07db466固定HEADの追補

このディレクトリは07db466時点の実測と独立確認を保存する。
実装ソースは1edc169と一致する。既存のv2 archive、88ファイルmanifest、原本を保持して追補する。

- FINAL-FOLLOWUP.md/jsonは独立レビュー担当による最終HEAD/CI/原本の再照合。
- pair-nan-followupはbaseline actualの2反復へNaNタグを投入した追加負対照。実プロセス終了0、対象2観測をnon-finite-evaluationで除外し、正式deltaはnull、rootの24正常反復組は有効だった。
- ci-final.jsonとci-final.log.gzは実装担当の取得結果。ci-direct.json/log.gzとpr-direct.jsonは独立担当がGitHubへ直接照会した結果。
- CI run 42954635780はhead07db466で両OS成功。Ubuntuは2587成功、macOSは2585成功と既存条件の2 skipped。両方で型検査・lock・buildが成功した。
- .log.gzは元のログbytesをgzipで保存したもの。

pair-nan-followup.mjsは07db466を固定し、入力と出力を新規保存する。
再計算時は07db466のcheckoutとロック済み依存を用意し、次を実行する。

```powershell
node --import tsx pair-nan-followup.mjs REPO_DIR NEW_OUTPUT_DIR
```

この追補の追加後の提出HEADとCI結果は、PR #218の提出コメントへ記録する。

2026年11月11日 JST
