### リポジトリ全体の日本語レビュー

`pnpm textlint` は通常の静的検査だけを実行し、全日本語文章の監査ファイルは生成しない。

リポジトリ全体を LLM で意味レビューする場合は次を使用する。

    pnpm textlint:review

対象を限定する場合は、ファイルやフォルダを引数に渡す。

    pnpm textlint:review -- .agents/docs
    pnpm textlint:review -- .agents/docs/Testing-Policy.md src/extension

変更ファイルだけを対象にする場合は次を使用する。

    pnpm textlint:review:changed

レビュー対象は `.textlint-cache/review-all.jsonl` または
`.textlint-cache/review-changed.jsonl` に1項目1行で保存する。
通常の textlint を同じ範囲で再実行すると、古いレビュー用ファイルは先に削除される。

textlint の警告有無に関係なく、次を検査する。

- 文法的には成立していても意味が不明瞭ではないか
- 実装に存在しない概念をコメント内で作っていないか
- 複数の処理を不自然な造語で圧縮していないか
- 対象・条件・処理・結果の関係が分かるか
- コードを読んだとき、コメントの説明と実装が一致しているか
- 英語を不自然に日本語化していないか
- 一般的な日本語表現へ置き換えられる技術語を雑に英語のまま使っていないか

意味が疑わしい文章を見つけた場合、
レビュー用ファイルの文章だけから修正を推測しない。

必ず `file` と `startLine` を使って元コードを確認し、
実装内容に基づいてコメントを修正する。

校正後は通常の textlint を再実行し、静的検査を通すと同時に古いレビュー内容を削除する。
