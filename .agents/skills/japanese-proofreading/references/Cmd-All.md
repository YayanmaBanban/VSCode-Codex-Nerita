# 全体・指定範囲の校正コマンド

対象リポジトリのルートで実行する。Git の変更状態に関係なく検査する。
対象ファイル・フォルダの引数を省略するとリポジトリ全体が対象になるため、全体の校正を依頼された場合だけ省略する。

## レビュー用データの生成

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:review --root ../../..
```

対象を限定する場合は、ファイルやフォルダを複数渡せる。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:review --root ../../.. .agents/docs packages/shared/src
```

本文・ファイル名・行番号は `.textlint-cache/review-all.jsonl` に1項目1行で保存する。
用語の指摘がある場合は `.textlint-cache/issues-all.json` も生成する。

## 静的検査と校正後の確認

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint --root ../../..
```

レビュー時に対象を指定した場合は、同じ引数を付ける。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint --root ../../.. .agents/docs packages/shared/src
```

このコマンドはレビュー用データを生成しない。
検査前に `all` 用の古い指摘・レビュー用ファイルを削除し、現在の指摘だけを保存する。
対象を変えても保存先は共通なので、複数の校正を同時に実行しない。
