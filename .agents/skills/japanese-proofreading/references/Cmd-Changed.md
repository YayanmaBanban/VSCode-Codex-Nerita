# 変更ファイルの校正コマンド

対象リポジトリのルートで実行する。変更行だけでなく、選択したファイル内の文章を検査する。

|対象ファイル・フォルダの引数|検査対象|
|----------------------------|----------------------------------------------------|
|省略する|HEAD との差分に含まれるファイルと未追跡ファイル|
|指定する|指定したファイル・フォルダ。Git の変更状態は問わない|

コミット済みの変更を校正する場合も、対象を引数で指定する。

## レビュー用データの生成

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:review:changed
```

対象を指定する場合は、ファイルやフォルダを複数渡せる。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:review:changed AGENTS.md apps/nerita-ui/src
```

出力先と保存内容は次のとおりとする。

|出力先|保存内容・生成条件|
|--------------------------------------|--------------------------------------------|
|`.textlint-cache/review-changed.jsonl`|本文・ファイル名・行番号を1項目1行で保存する|
|`.textlint-cache/issues-changed.json`|用語の指摘がある場合に、その指摘を保存する|

## 静的検査と校正後の確認

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:changed
```

レビュー時に対象を指定した場合は、再検査でも同じ引数を付ける。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:changed AGENTS.md apps/nerita-ui/src
```

このコマンドはレビュー用データを生成しない。
検査前に `changed` 用の古い指摘・レビュー用データを削除し、現在の指摘だけを保存する。
対象ファイル・フォルダを変えても `changed` 用の保存先は共通なので、複数の校正を同時に実行しない。
