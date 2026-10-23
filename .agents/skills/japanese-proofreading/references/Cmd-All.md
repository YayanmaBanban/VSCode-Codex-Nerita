# 全体・指定範囲の校正コマンド

対象リポジトリのルートで実行する。Git の変更状態に関係なく検査する。

|対象ファイル・フォルダの引数|検査対象|
|----------------------------|--------------------------|
|省略する|リポジトリ全体|
|指定する|指定したファイル・フォルダ|

引数を省略するのは、リポジトリ全体の校正を依頼された場合だけとする。

## レビュー用データの生成

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:review
```

対象を限定する場合は、ファイルやフォルダを複数渡せる。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint:review .agents/docs packages/shared/src
```

出力先と保存内容は次のとおりとする。

|出力先|保存内容・生成条件|
|----------------------------------|--------------------------------------------|
|`.textlint-cache/review-all.jsonl`|本文・ファイル名・行番号を1項目1行で保存する|
|`.textlint-cache/issues-all.json`|用語の指摘がある場合に、その指摘を保存する|

## 静的検査と校正後の確認

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint
```

レビュー時に対象を指定した場合は、再検査でも同じ引数を付ける。

```powershell
.\.agents\skills\japanese-proofreading\run.cmd textlint .agents/docs packages/shared/src
```

このコマンドはレビュー用データを生成しない。
検査前に `all` 用の古い指摘・レビュー用データを削除し、現在の指摘だけを保存する。
対象ファイル・フォルダを変えても `all` 用の保存先は共通なので、複数の校正を同時に実行しない。
