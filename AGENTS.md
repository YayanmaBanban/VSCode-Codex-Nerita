# プロジェクトの指示

ReactのWebviewは `src/webview/`、Extension Hostの処理は `src/extension/`、共通の通信型・検証処理は `src/shared/` にあります。

## コーディング規約

- コメントは日本語で記述する。
- ファイルの役割を1〜3行、関数・型定義の役割を各1行程度で説明する。
- 重要な処理には、意図や制約を1〜3行で補足する。
- 1ファイル200行を目安とし、責務に応じて分割する。

## 作業に応じた参照先

該当する作業を始める際に、対応するガイドを参照してください。

| 作業                                                     | 参照先                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `src/webview/` のファイル追加・分割・移動・フォルダ整理  | [ディレクトリ構成](.agents/docs/Directory-Structure.md)     |
| 複数ファイルの依存調査・構造変更・コードレビュー         | [コード調査・依存グラフ](.agents/docs/Code-Review-Graph.md) |
| Webview UIの作成                                         | [UI実装](.agents/docs/UI-Implementation.md)                 |
| Webview UIの表示・操作・アニメーションの変更、UIレビュー | [UIレビュー](.agents/docs/UI-Review-Guide.md)               |

対象が明確な局所修正や文書のみの変更では、無関係なガイドや全体の依存グラフを読み込む必要はありません。

## Webview UIとExtension Hostの境界

UIライブラリやWeb向けアニメーションはWebviewに使用します。VS Code API・Node.js・ACPプロセスの処理はExtension Hostに置き、Webviewとは検証済みメッセージで通信してください。

実行・配布はWindows x64のローカルVS CodeとNode.js 22以降を前提とします。StorybookはUIの確認用で、Extension Hostや実際のACP接続の検証とは分けます。

## 実行コマンド

ルートで `pnpm watch`、`pnpm check`（Lint・型チェック）、`pnpm test`（拡張機能の結合テスト）、`pnpm compile`（開発ビルド）・`pnpm package`（本番ビルド）を実行できます。検証は変更の影響に合わせて選び、UIの検証は該当ガイドに従います。WindowsでPowerShellの実行ポリシーにより起動できない場合は `pnpm.cmd` を使ってください。
