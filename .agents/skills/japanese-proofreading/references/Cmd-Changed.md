# 変更ファイルの校正コマンド

対象リポジトリのルートで実行する。対象ファイル・フォルダの引数を省略すると、HEAD との差分と未追跡ファイルが対象になる。
変更行だけでなく、選択したファイル内の文章を検査する。

## レビュー用データの生成

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:review:changed --root ../../..
```

対象を指定する場合は、ファイルやフォルダを複数渡せる。
明示した対象は Git の変更状態に関係なく検査する。コミット済みの変更を校正する場合もこの形式を使う。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:review:changed --root ../../.. AGENTS.md apps/nerita-ui/src
```

本文・ファイル名・行番号を `.textlint-cache/review-changed.jsonl` に1項目1行で保存する。
用語の指摘がある場合は `.textlint-cache/issues-changed.json` も生成する。

## 静的検査と校正後の確認

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:changed --root ../../..
```

レビュー時に対象を指定した場合は、同じ引数を付ける。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:changed --root ../../.. AGENTS.md apps/nerita-ui/src
```

このコマンドはレビュー用データを生成しない。
検査前に `changed` 用の古い指摘・レビュー用ファイルを削除し、現在の指摘だけを保存する。
対象ファイル・フォルダを変えても `changed` 用の保存先は共通なので、複数の校正を同時に実行しない。
