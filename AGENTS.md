# プロジェクトの指示

ReactのWebviewは `src/webview/`、Extension Hostの処理は `src/extension/`、共通の通信型・検証処理は `src/shared/` にあります。

## コーディング規約

- コメントは日本語で記述する。処理内容の言い換えではなく、意図・制約・順序・寿命・競合条件・境界など、コードだけでは分かりにくい理由を説明する。
- ファイル先頭では役割を1〜3行で説明する。境界処理・副作用・状態遷移・非自明な関数や型には必要に応じて1行程度の説明を付け、名前や型から明らかなものにはコメントを追加しない。
- 長い処理では、入力検証・状態確定・副作用・通知など意味の切り替わりに空行を入れる。空行やコメントで整理できない複数責務は小関数や別ファイルへ分割する。
- コードの改行と整形はPrettierを正とし、フォーマッタに逆らう手動整形は行わない。
- 1ファイル200行を目安とし、責務に応じて分割する。行数だけを理由に意味のない分割を行わない。

## 作業に応じた参照先

該当する作業を始める際に、対応するガイドを参照してください。

| 作業                                                                                     | 参照先                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
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

実行ポリシーは、`-ExecutionPolicy RemoteSigned`

文字化けを回避するため、`-Encoding utf8`をつける

### pnpm

ルートで `pnpm watch`、`pnpm check`（Lint・型チェック）、`pnpm test`（拡張機能の結合テスト）、`pnpm compile`（開発ビルド）・`pnpm package`（本番ビルド）を実行できます。検証は変更の影響に合わせて選び、UIの検証は該当ガイドに従います。WindowsでPowerShellの実行ポリシーにより起動できない場合は `pnpm.cmd` を使ってください。
