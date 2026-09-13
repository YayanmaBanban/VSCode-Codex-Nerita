# プロジェクトの指示

Codex ACP を利用する VS Code 拡張機能です。Extension Host は `src/extension/`、Webview は `src/webview/`、共有通信型は `src/shared/`、Storybook・Vitest 設定は `config/`、テストは `tests/` にあります。サイドバーのチャット UI と ACP 接続を実装しています。

## コーディング規約

- コメントは日本語で記述する。
- ファイルの役割を1〜3行、関数・型定義の役割を各1行程度で説明する。
- 重要な処理には、意図や制約を1〜3行で補足する。
- 1ファイル200行を目安とし、責務に応じて分割する。

## 作業に応じた参照先

| 作業                                                   | 参照先                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| ソース・設定・テストの追加・分割・移動                 | [ディレクトリ構成](.agents/docs/Directory-Structure.md)      |
| 複数ファイルの依存調査・構造変更・コードレビュー       | [コード調査・依存グラフ](.agents/docs/Code-Review-Graph.md)  |
| React UIの表示・操作・アニメーションの変更、UIレビュー | [UIレビュー](.agents/docs/UI-Review-Guide.md)                |
| UIレビューのシナリオ・実行環境の追加・変更             | [UIレビューの実装](.agents/docs/UI-Review-Implementation.md) |
| 指示・ガイドの保守                                     | [指示ファイルの保守](.agents/docs/README.md)                 |

対象が明確な局所修正や文書のみの変更では、無関係なガイドや全体の依存グラフを読み込む必要はありません。

## Extension Host と Webview の境界

VS Code API・Node.js・ACP プロセスの処理は Extension Host 側に置きます。Webview を追加する場合、React UI からこれらを直接 import せず、メッセージ通信の境界を設けてください。ブラウザでも実行する UI は VS Code 固有 API を直接呼ばず、Storybook では代替実装を渡せる構成にします。

## 実行コマンド

ルートから実行します。Windows の PowerShell で実行ポリシーにより起動できない場合は `pnpm.cmd` を使ってください。

| 用途                       | コマンド                                                  |
| -------------------------- | --------------------------------------------------------- |
| 拡張機能のビルド・監視     | `pnpm compile`・`pnpm watch`                              |
| 本番向けバンドル           | `pnpm package`                                            |
| Lint・型チェック           | `pnpm lint`・`pnpm check-types`・`pnpm check-types:tests` |
| 拡張機能テスト             | `pnpm test`                                               |
| Storybook 起動・静的ビルド | `pnpm storybook`・`pnpm build-storybook`                  |
| Story のブラウザテスト     | `pnpm test:storybook`                                     |
| UIレビュー・レポート       | `pnpm ui-review`・`pnpm ui-review:report`                 |

コマンドの定義は `package.json` を正とし、検証は変更の影響に合わせて選びます。Host 単体テストは `pnpm test:unit`、開発設定の型検査は `pnpm check-types:tools` です。スクリプトの存在だけで実行可能と判断しないでください。
