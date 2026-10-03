<!-- textlint-disable ja-technical-writing/no-mix-dearu-desumasu -->

# Nerita

VS Code 上で Codex と Pi を利用する拡張機能です。開発には Windows x64 と Node.js 22.19.0 以降、pnpm を使用します。

## 構成

- `apps/vscode-nerita/`: 拡張機能のマニフェスト、Extension Host、VSIX のビルドと配布。
- `apps/nerita-ui/`: React Webview、Storybook、画像・SVG の編集元。
- `packages/shared/`: Webview と Extension Host の実装に依存しない、共通の通信型・検証処理。
- `tests/`・`config/`・`scripts/`: 全体の検証と開発ツール。

ルートの `package.json` にワークスペース全体のコマンドを定義しています。ビルドは `packages/shared/`、`apps/nerita-ui/`、`apps/vscode-nerita/` の順に実行します。

## 開発と配布

```sh
pnpm install
pnpm check
pnpm compile
pnpm watch
pnpm package:vsix
```

リポジトリルートを VS Code で開き、`Run Extension` を実行すると、`apps/vscode-nerita` を拡張機能として起動します。
`pnpm package` は本番ビルド、`pnpm package:vsix` は本番ビルドを含む VSIX 生成です。
生成先は `apps/vscode-nerita/dist/nerita.vsix`、拡張機能の ID は `nerita-local.nerita` です。

UI の成果物は `apps/vscode-nerita/dist/webview/` に集めます。画像の編集元は `apps/nerita-ui/media/` に置き、VS Code が直接使う画像3点だけを `apps/vscode-nerita/dist/media/` へコピーします。
ランタイムとスキーマも `apps/vscode-nerita/dist/` に集めます。配布用の README・LICENSE・CHANGELOG は、ビルド時にリポジトリルートから `apps/vscode-nerita/` へコピーします。

## 検証

`pnpm test`（`pnpm test:product`）は、製品の単体・契約・結合テストをローカルで実行します。`pnpm test:distribution` は VSIX に同梱した SDK と実際の Extension Host を検証します。
UI の表示・操作は `pnpm storybook`、`pnpm test:storybook`、`pnpm test:webview` で確認します。
ルートの開発依存には、テストが直接利用する Pi SDK や TOML・スキーマの処理も含みます。配布用ランタイムは `apps/vscode-nerita/` の依存から解決します。

<!-- textlint-enable ja-technical-writing/no-mix-dearu-desumasu -->
