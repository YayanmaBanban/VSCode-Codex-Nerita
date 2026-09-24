# プロジェクトの指示

notionのリンクを記載するのを一切禁止する

ReactのWebviewは `src/webview/`、Extension Hostの処理は `src/extension/`、共通の通信型・検証処理は `src/shared/` にあります。

## 作業に応じた参照先

該当する作業を始める際に、対応するガイドを参照してください。

| 作業                                                                                     | 参照先                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| コードの追加・変更                                                                       | [コード実装](.agents/docs/Code-Implementation.md)           |
| `src/webview/`・`src/extension/`・`src/shared/` のファイル追加・分割・移動・フォルダ整理 | [ディレクトリ構成](.agents/docs/Directory-Structure.md)     |
| 複数ファイルの依存調査・構造変更・コードレビュー                                         | [コード調査・依存グラフ](.agents/docs/Code-Review-Graph.md) |
| Webview UIの作成                                                                         | [UI実装](.agents/docs/UI-Implementation.md)                 |
| Webview UIの表示・操作・アニメーションの変更、UIレビュー                                 | [UIレビュー](.agents/docs/UI-Review-Guide.md)               |

対象が明確な局所修正や文書のみの変更では、無関係なガイドや全体の依存グラフを読み込む必要はありません。

## Webview UIとExtension Hostの境界

UIライブラリやWeb向けアニメーションはWebviewに使用します。VS Code API・Node.js・Codex App Serverプロセスの処理はExtension Hostに置き、Webviewとは検証済みメッセージで通信してください。共有する通信型・検証処理は `src/shared/` に置き、React・DOM・VS Code API・Node.js専用APIに依存させません。

実行・配布はWindows x64のローカルVS Code、開発用Node.jsは22以降を前提とします。Extension HostはVS Code内のNode.jsで動作します。StorybookはUIの確認用で、Extension Hostや実際のCodex App Server接続の検証とは分けます。

## 実行コマンド

### powershell

`pwsh`を使用する

### pnpm

ルートで `pnpm watch`、`pnpm check`（Lint・型チェック）、`pnpm test`（拡張機能の結合テスト）、`pnpm compile`（開発ビルド）・`pnpm package`（本番ビルド）を実行できます。検証は変更の影響に合わせて選び、UIの検証は該当ガイドに従います。WindowsでPowerShellの実行ポリシーにより起動できない場合は `pnpm.cmd` を使ってください。
