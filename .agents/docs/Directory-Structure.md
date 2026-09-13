# プロジェクトのディレクトリ構成

ソース・設定・テストの追加や移動時に参照します。以下のパスはリポジトリルート基準です。

## 現在の配置

| 役割 | 配置 |
| --- | --- |
| Extension Host の実装 | `src/extension/extension.ts` |
| 拡張機能の宣言・コマンド・依存関係 | `package.json` |
| バンドル・型設定 | `esbuild.js`・`tsconfig.json` |
| Storybook 設定 | `config/storybook/main.ts`・`config/storybook/preview.tsx` |
| Story のブラウザテスト設定 | `config/vitest.config.ts`・`config/vitest.shims.d.ts` |
| 開発ツールの型設定 | `config/tsconfig.json` |
| 拡張機能テスト・型設定 | `tests/extension.test.ts`・`tests/tsconfig.json` |
| VS Code Test CLI 設定 | `tests/.vscode-test.mjs` |
| UIレビュー設定 | `tests/e2e/config/ui-review.config.ts` |
| UIレビューシナリオ・型設定 | `tests/e2e/ui-review/`・`tests/e2e/tsconfig.json` |
| 外部サイト向け初期サンプル（UIレビュー対象外） | `tests/e2e/specs/example.spec.ts` |
| デバッグ・タスク設定 | `.vscode/launch.json`・`.vscode/tasks.json` |

生成物は `dist/extension.js`、`dist/storybook/`、`dist/ui-review/`、`dist/vitest/coverage/` に出力する設定です。拡張機能テストのコンパイル先は `out/` です。設定やテスト本体を生成物のディレクトリへ置かないでください。

## 実装時に修正した参照

- `esbuild.js` は `src/extension/extension.ts` と `src/webview/index.tsx` を個別にバンドルします。
- `test` は `tests/.vscode-test.mjs` を明示し、設定内のパスはリポジトリルートへ解決します。
- チャット Story は `src/webview/chat/ChatApp.stories.tsx`、UIレビューは `tests/e2e/ui-review/chat.spec.ts` です。
- Webview 型設定は `src/webview/tsconfig.json`、共有型は `src/shared/`、Host 単体テストは `tests/unit/`、実行資産の梱包処理は `config/package-runtime.cjs` です。

VSIX は `dist/codex-acp.vsix`、実行資産は `dist/runtime/`、Webview 資産は `dist/webview/` に出力します。

## 追加・分割の判断

- Extension Host の機能は `src/extension/` 内で役割ごとにまとめます。コマンド登録と処理本体は必要に応じて分割します。
- ブラウザ側の入口・UI・通信境界は `src/webview/` に配置します。通信は `vscodeBridge.ts` を経由します。
- Component・Hook・型・CSS・Story は同じ機能の近くに置きます。空の分類フォルダや不要な再exportファイルを増やしません。
- 共通化は役割と変更理由が共通かで判断し、迷ったら機能側に置きます。
- Node.js・VS Code API に依存する処理をブラウザ用の公開ファイルから再exportしません。共有する型は実行環境に依存しない形にします。

## 移動時の確認

import・CSS・素材の参照に加え、バンドルの入口、`package.json` の main・scripts、型設定の include/exclude、Storybook の glob、テスト検出、デバッグ設定、文書を確認します。

Extension Host、ブラウザ、Mocha、Playwright の型環境を混在させないでください。変更の影響に応じて型チェック・ビルド・関連テストを実行し、生成物だけが残った状態を成功と判断しないでください。
