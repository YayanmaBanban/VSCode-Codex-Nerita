---
name: japanese-proofreading
description: まとまった変更や指定範囲の日本語を後から校正する。コメント・JSDoc・Markdown・テキスト文書の静的検査と、周辺コードに基づく意味の確認・修正に使う。日本語を含む通常の実装や文書編集だけでは使用せず、校正・文章レビューを依頼された場合に使用する。
---

# 日本語の校正

通常の実装とは別に、依頼された範囲の文章を校正する。
別スレッドで GPT-6.1 Sol、推論強度 high を選択して実行する運用を想定する。
このスキル自体はモデルを切り替えず、サブエージェントも起動しない。

## 対象と実行方法

- [日本語の校正基準](references/Japanese-Comments.md)を読み、静的検査だけでなく説明と実装の一致を確認する。
- 全体の校正を依頼された場合だけ、[全体レビューの手順](references/TextLint-All.md)も読む。
- 範囲の指定がなければ未コミット変更を対象とする。コミット済みの変更や特定の機能が対象なら、差分から対象ファイルを選び、引数で指定する。
- `--changed` は HEAD との差分と未追跡ファイルを選ぶ。変更行だけでなく選択したファイル内の文章を抽出するため、修正範囲は依頼と差分に照らして判断する。

このスキルは private な Node.js パッケージを含む。依存関係は本リポジトリの pnpm ワークスペースで管理する。未導入の場合はリポジトリルートで `pnpm install` を実行する。単独でコピーした場合はスキルのディレクトリで依存関係を導入する。

以下は本リポジトリのルートから実行する例。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:review:changed --root ../../..
pnpm --dir .agents/skills/japanese-proofreading textlint:review:changed --root ../../.. AGENTS.md apps/nerita-ui/src
```

`--root` はコマンド実行時の作業ディレクトリを基準に解決する。`pnpm --dir` を使う場合はスキルのディレクトリが基準になる。対象ファイルの引数は `--root` を基準にする。別の場所に配置した場合は、配置に合わせてパスを指定する。

設定と依存関係はスキル側から読み、対象固有の `.textlintignore` と `.textlint-cache/` は対象リポジトリ側で扱う。`.git/`・`node_modules/`・`.textlint-cache/` は常に除外する。

## 校正と完了

1. レビュー用の JSONL と検査結果を読む。終了コード 1 は文章の指摘を表す。実行エラーの場合は原因を解消してからレビューする。
2. JSONL の `file` と `startLine` を使って元の文章と周辺コードを読む。識別子・固有名詞を機械的に翻訳せず、実際の処理を自然な日本語で説明する。
3. 指摘のない文章も依頼範囲で確認する。校正に合わせて製品の動作を変更しない。
4. 同じ対象へ `textlint:changed` または `textlint` を実行する。これにより静的に検査し、古いレビュー用データを削除する。
5. 校正した範囲、修正内容、検査結果、未解決・未確認事項を簡潔に報告する。静的検査の成功だけで意味の確認を済ませたと扱わない。

```sh
pnpm --dir .agents/skills/japanese-proofreading textlint:changed --root ../../..
```

校正は依頼時に実行する。通常の実装完了条件や `pnpm package` にこの手順を追加しない。
