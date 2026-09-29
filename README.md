# Nerita

VS Code 上で Codex と Pi を利用する拡張機能です。開発には Windows x64 と Node.js 22 以降、pnpm を使用します。

## 構成

- `apps/vscode-nerita/`: Extension Manifest、Extension Host、VSIX のビルドと配布。
- `apps/nerita-ui/`: React Webview、Storybook、画像・SVG の正本。
- `packages/shared/`: Host に依存しない通信型・検証処理。
- `tests/`・`config/`・`scripts/`: 全体の検証と開発ツール。

ルートの `package.json` は ワークスペース全体の実行入口です。ビルドは shared、UI、VS Code app の順に実行します。

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
生成先は `apps/vscode-nerita/dist/nerita.vsix`、Extension ID は `nerita-local.nerita` です。

UI の成果物は `apps/vscode-nerita/dist/webview/` に収集します。画像の正本は `apps/nerita-ui/media/` に置き、VS Code が直接使う3資産だけを `dist/media/` へコピーします。
runtime とスキーマも VS Code app の `dist/` に集約します。配布用の README・LICENSE・CHANGELOG はビルド時にルートの正本から収集します。

## 検証

`pnpm test:host` は単体・契約・結合テスト、`pnpm test:runtime` は runtime の配布検証、`pnpm test` は実際の Extension Host での検証です。
UI は `pnpm storybook`、`pnpm test:storybook`、`pnpm ui-review` で確認します。
ルートの開発依存には、テストが直接利用する Pi SDK や TOML・スキーマ処理も含みます。配布用 runtime は VS Code app の依存から解決します。
