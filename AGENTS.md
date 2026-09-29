# リポジトリの運用

- notion のリンクをファイル内に残さない
- ローカルの絶対パスをファイル内に残さない。相対パスで扱う
- ユーザの指示なく、`./README.md` を更新しない
    - 作業内容を残したい場合は、./docs/working_memory/内に残す
    - `working_memory` には、対応を見送った要素や今後の対応、レビュー結果など価値のあるものを残し、Notion を見るだけで済むものや単純な作業内容などで無駄に増やさない

# 文章のルール

[日本語コメントの校正](.agents/docs/Japanese-Comments.md)

# プロジェクトの指示

React の Webview は `apps/nerita-ui/src/`、Extension Host の処理は `apps/vscode-nerita/src/extension/` にあります。共通の通信型・検証処理は `packages/shared/src/` に置きます。

開発中に互換性を考える必要はありません。

## 作業に応じた参照先

該当する作業を始める際に、対応するガイドを参照してください。

| 作業 | 参照先 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| コードの追加・変更 | [コード実装](.agents/docs/Code-Implementation.md) |
| `apps/nerita-ui/src/`・`apps/vscode-nerita/src/extension/`・`packages/shared/src/` のファイル追加・分割・移動・フォルダ整理 | [ディレクトリ構成](.agents/docs/Directory-Structure.md) |
| 複数ファイルの依存調査・構造変更・コードレビュー | [コード調査・依存グラフ](.agents/docs/Code-Review-Graph.md) |
| Webview UI の作成 | [UI 実装](.agents/docs/UI-Implementation.md) |
| テスト作成 | [テストポリシー](.agents/docs/Testing-Policy.md) |
| Webview UI の表示・操作・アニメーションの変更、UI レビュー | [UI レビュー](.agents/docs/UI-Review-Guide.md) |

対象が明確な局所修正や文書のみの変更では、無関係なガイドや全体の依存グラフを読み込む必要はありません。

## Webview UI と Extension Host の境界

UI ライブラリや Web 向けアニメーションは Webview に使用します。VS Code API・Node.js・Codex App Server プロセスの処理は Extension Host に置き、Webview とは検証済みメッセージで通信してください。共有する通信型・検証処理は `packages/shared/src/` に置き、React・DOM・VS Code API・Node.js 専用 API に依存させません。

実行・配布は Windows x64 のローカル VS Code、開発用 Node.js は22以降を前提とします。Extension Host は VS Code 内の Node.js で動作します。Storybook は UI の確認用で、Extension Host や実際の Codex App Server 接続の検証とは分けます。

## 実行コマンド

### pnpm

ルートで `pnpm watch`、`pnpm check`（Lint・型チェック）、`pnpm test`（拡張機能の結合テスト）を実行できます。`pnpm compile` は開発ビルド、`pnpm package` は本番ビルドです。検証は変更の影響に合わせて選び、UI の検証は該当ガイドに従います。Windows で PowerShell の実行ポリシーにより起動できない場合は `pnpm.cmd` を使ってください。
