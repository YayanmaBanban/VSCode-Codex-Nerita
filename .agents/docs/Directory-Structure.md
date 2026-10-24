# ソースのディレクトリ構成

この文書は Webview・Extension Host・共有領域の配置と依存境界を示す。ファイルの追加・分割・移動・フォルダ整理、領域間の依存・通信境界、テーマ定義を変更するときに参照する。

以下のパスはリポジトリルートからの相対パスとする。

## 配置の判断

リポジトリルートはワークスペース全体のコマンドの実行場所とする。VS Code のマニフェスト・Extension Host のビルド・VSIX の配布は `apps/vscode-nerita/` で管理する。

画像・SVG の編集元は `apps/nerita-ui/media/` に置く。VS Code が直接読む拡張機能のアイコンだけを、ビルド時に `apps/vscode-nerita/dist/media/` へコピーする。

実行環境に応じて、Webview・Extension Host・共有領域から配置先を選ぶ。Webview は Svelte コンポーネント・画面のコントローラー・CSS、Extension Host は VS Code 連携・プロセス通信、共有領域は通信型・検証処理を担当する。

| 役割 | 配置 |
| --- | --- |
| Svelte の起動・画面の組み立て | `apps/nerita-ui/src/index.ts`・`apps/nerita-ui/src/chat/` |
| 共通 UI 部品・テーマ | `apps/nerita-ui/src/ui/`・`apps/nerita-ui/src/ui/theme.css` |
| Webview 側の Extension Host との通信 | `apps/nerita-ui/src/bridge/vscodeBridge.ts` |
| 拡張機能の起動・VS Code 連携 | `apps/vscode-nerita/src/extension/extension.ts`・`apps/vscode-nerita/src/extension/webview/` |
| バックエンド固有のエージェント連携 | `apps/vscode-nerita/src/extension/backends/codex/`・`apps/vscode-nerita/src/extension/backends/pi/` |
| Extension Host 共通のセッション・添付処理 | `apps/vscode-nerita/src/extension/session/` |
| 両側で共有する通信型・検証処理 | `packages/shared/src/` |

## 領域内の配置と共通化

領域内では、次の単位で分割を検討する。

| 領域 | 分割の単位 |
| --- | --- |
| Webview | コンポーネント・コントローラー |
| Extension Host | 制御・通信・データ変換 |
| 共有領域 | 契約・検証 |

runes を使うコントローラーは `.svelte.ts`、純粋な型・変換処理は `.ts` に置く。

- 複数箇所で使うツールカード専用ボタンは `apps/nerita-ui/src/chat/tools/` に置く。機能固有のデータや操作に依存しない UI 部品は `apps/nerita-ui/src/ui/` での共通化を検討する。
- 同じ領域内で使い回すだけの処理を、領域間共有用の `packages/shared/src/` へ移さない。

## Webview と Extension Host の境界

- Webview 側から `apps/vscode-nerita/src/extension/` や VS Code API・Node.js 専用モジュールをインポートしない。
- Extension Host 側も `apps/nerita-ui/src/` の UI 実装をインポートしない。
- 通信は `apps/nerita-ui/src/bridge/vscodeBridge.ts` のメッセージ経由で行う。
- 両側に必要な型・検証処理は `packages/shared/src/` に置く。
- 共有領域を両領域の実装や Svelte・DOM・VS Code API・Node.js 専用 API に依存させない。
- Webview 用と Extension Host 用のエクスポートを同じ公開ファイルにまとめない。

共有する型・検証処理は `@nerita/shared/*` から参照する。`Bridge` 型は `packages/shared/src/bridge.ts` で定義する。バンドラーは `nerita-source` 条件でソースを解決する。製品検証でも同じ条件でソースをバンドルして実行する。通常の Node.js のモジュール解決では、`pnpm build:shared` で生成した JavaScript を使う。

UI の色は `apps/nerita-ui/src/ui/theme.css` にまとめる。VS Code のテーマ変数がない場合も、明暗に応じた既定色を使う。Svelte のテンプレートでは用途別の色クラスや UI 用変数を参照する。

## ストーリー・テストと移動時の確認

Storybook 専用コードは `apps/nerita-ui/stories/` に置き、製品のソースに対応する機能別の構成にする。チャットのストーリーは `apps/nerita-ui/stories/chat/`、ツールカードのストーリーはその中の `tools/` に置く。ストーリー専用の通信ブリッジ・応答モックは `apps/nerita-ui/stories/chat/mocks/` に置く。表示用のサンプルデータは `apps/nerita-ui/stories/chat/fixtures/` に置く。

実際の UI コンポーネントは `apps/nerita-ui/src/` に置き、ストーリー側からインポートする。製品経路の検証は `tests/product/`、実際の VS Code での検証は `tests/vscode/`、共通の補助コードは `tests/support/` に置く。テストの使い分けは[プロジェクト固有の検証環境](Project-Verification.md)を参照する。

ストーリーの型チェックには `apps/nerita-ui/stories/tsconfig.json` を使う。ストーリー専用の Tailwind CSS クラスは `apps/nerita-ui/.storybook/tailwind.css` で収集する。本体の走査対象にストーリーを追加しない。

ファイルの移動時は、次の参照や設定を確認し、旧パスを更新する。

- インポート・再エクスポート・CSS
- 拡張機能の URI を基準にした画像などのパス
- Webview の Vite 設定と Extension Host の esbuild 設定
- Storybook・テストの検出設定
- スクリプト・文書内のパス

変更の影響に応じて、型チェック・ビルド・関連テストで参照切れがないか確認する。
