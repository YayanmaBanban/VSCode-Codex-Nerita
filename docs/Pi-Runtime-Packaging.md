# Pi Runtime 配布設計（Phase 7）

2026-09-22。対象は `@earendil-works/pi-coding-agent@0.86.1` と、その内部の `pi-ai@0.86.1`。
Phase 7-1のUI Contribution、Phase 8のReasoning / Fast Mode / Quotaは別工程。

## 構成

`config/runtime/pi-entry.mjs` はHostが使う公開SDK APIと配布検証用の画像・資産APIを明示的にexportする。
`config/package-pi.cjs` がESM・code splittingでbundleし、Hostが読む `dist/runtime/pi.mjs` は維持する。
Piを起点にした `copyRuntimePackage()` の再帰コピーは廃止した。

```text
dist/runtime/
├─ pi.mjs
├─ pi/
│  ├─ core.mjs
│  ├─ openai-codex-responses-*.mjs
│  ├─ anthropic-messages-*.mjs
│  ├─ google-generative-ai-*.mjs
│  ├─ openai-completions-*.mjs
│  ├─ openai-responses-*.mjs
│  ├─ openai-codex-*.mjs / anthropic-*.mjs  # OAuth
│  ├─ image-resize-worker.mjs
│  ├─ chunk-*.mjs / virtual-modules-*.mjs / jiti-*.mjs
│  ├─ package.json / bundle-meta.json / licenses/
│  └─ dist/ / docs/                         # 相対参照する資産
└─ node_modules/
   ├─ @openai/                             # 従来のCodex実行資産
   └─ @silvia-odwyer/photon-node/           # JS・WASM・metadataのみ
```

組み込みproviderは `openai-codex` / `anthropic` / `google` の3つ。
`models.json`、任意baseUrl、Extensionのcustom provider登録は維持する。
汎用 `openai-completions` / `openai-responses` adapterを残し、ローカル互換サーバーでツールを含む会話を検証する。
reasoning・image等のモデルmetadataはSDKのcatalogを使用する。モデル別の追加UIやローカルLLM専用UIは実装しない。

## 固定SDKへの互換処理

`config/pi-bundle-plugin.cjs` は上流ソースをディスク上で変更せず、bundle入力だけを変換する。

- `providers/all` を3providerのcatalogへ置換。`ModelRuntime` と互換API層で同じcatalogを共有する。
- `compat` のAPI登録も5種類へ制限する。対象APIの旧stream関数名は維持する。
- 変数によるOAuth importを静的に追跡できる遅延importへ変換する。
- `PI_BUNDLED_NODE` を有効にし、TypeScript ExtensionはSDK標準のjiti static / virtual modulesで読み込む。
- Extension向けのSDK namespaceからCLI起動・対話モードのexportを除く。ツール、Skills、Session、TypeBox、対象providerの互換APIは保持する。
- 画像workerのURLを出力した `.mjs` へ合わせる。PhotonはWASM相対参照を維持するため小さな外部パッケージとして残す。

その他の組み込みprovider、Radius OAuth、画像生成APIは非対応。Radius OAuthの設定は明示的なエラーになる。
画像の読込・変換・縮小は引き続き対応する。
ExtensionsとSDKが参照するtheme・HTML export template・文書も同梱する。
bundleに含まれる依存のライセンスは `licenses/`、ソース内表記は `.LEGAL.txt` に保存する。

## SDK更新

1. `package.json` のSDK固定版、解決されたpi-ai版、`SUPPORTED_PI_VERSION` を揃える。
2. `config/pi-sdk-contract.json` に列挙した上流ファイルの変更を確認し、必要なら互換処理を修正する。
3. 確認後にSHA-256を更新する。hashの自動追従は行わない。
4. `pnpm test:runtime`、`pnpm test:pi:chat`、本番VSIXの作成と展開先での同じ検証を実行する。

バージョン不一致や確認済みソースの変更はビルドを停止する。
配布テストは不要providerのcatalog・SDKが入り直した場合、API chunkが統合された場合、外部依存や相対資産の解決漏れも検出する。

## サイズ実測

Windows x64、同じ依存・本番ビルド条件で `pnpm package:vsix` を比較。単位はMiB（1,048,576 bytes）。
Pi部分は `dist/runtime/` から `node_modules/@openai/` を除いた全ファイルで集計した。

| 指標               |                          変更前 |                        変更後 |
| ------------------ | ------------------------------: | ----------------------------: |
| VSIX全体           |                      169.96 MiB |                  約141.86 MiB |
| Pi部分・展開後     | 117,382,593 bytes（111.94 MiB） | 14,013,911 bytes（13.36 MiB） |
| Pi部分・ZIP圧縮後  |                31,395,043 bytes |               5,613,852 bytes |
| Pi部分・ファイル数 |                          14,010 |                           166 |

Pi部分の展開サイズは約88.1%削減。VSIX全体は約16.5%削減。
CodexのWindows実行資産がVSIXの大半を占めるため、全体サイズの削減幅はPi部分より小さい。
サイズ比較用の生成物は `dist/nerita-phase7-before.vsix` と `dist/phase7-sizes.json`。

## 検証

- `pnpm check`：Lint・本体/Story/テストの型検査。
- `pnpm test:unit`：236件成功。
- `pnpm test:runtime`：12件成功。開発ツリー外の空白・日本語・`#` を含むパスへ実bundleを出力して検証。
- `pnpm test:pi:chat`：ローカル模擬APIで送信、Steer、Stop、read / ls / write / edit / PowerShell、承認、履歴・Fork・復元、Skills、Extensions、認証操作を検証。
- 展開済みVSIXを渡した `pnpm test:pi:chat <extension>` も成功。
- 展開済みVSIXをVS Code 1.138.0で起動した結合テスト6件も成功。Piの本文・ツール・停止、Codex App Server起動、認証画面、コマンド、配布資産を確認。旧配置を前提にしていた資産検査を新構成へ更新した。

3providerのAPI chunkとOAuth flowは配布物のみでロード済み。クラウド実アカウントでのログイン・モデルへの実リクエストは、この配布検証では実施していない。
