# Phase 25：ACL を変更せずに VS Code 上で Webview を検証する起動方法

## 次回の起動方針

VS Code の実機検証でサンドボックス内からの起動が ACL エラーになる場合は、サンドボックス外の実行経路を試す。その際は Codex の `exec_command` に `sandbox_permissions: "require_escalated"` を指定する。2026-10-12 の25-0では、この経路で既存の VS Code 上の Webview の受け入れ検証が成功した。VS Code の公開バイナリのコピーと、検証用の隔離プロファイルを使用し、ACL は変更していない。

`require_escalated` はエージェントの実行経路を切り替える指定であり、Windows の「管理者として実行」を指定するものではない。ファイルの ACL 変更や `ALL APPLICATION PACKAGES` への権限追加を起動の前提にしない。

## 既存の検証経路を使う条件

通常の入口は、リポジトリルートを作業ディレクトリとして次のコマンドを実行する経路。今回そのまま実行して成功したコマンドではなく、次回まず試す既存の入口として記載する。

```json
{
  "cmd": "rtk proxy pnpm.cmd run test:webview vscode-bridge webview-backend",
  "shell": "powershell",
  "login": false,
  "sandbox_permissions": "require_escalated"
}
```

`config/test-distribution.cjs` は VSIX を生成・展開し、`config/test-webview.cjs` が VS Code を起動する。既存の `--user-data-dir`、`--extensions-dir`、モデル代替サーバーを維持し、利用者のプロファイルへ拡張をインストールしない。サンドボックス外での実行にも、その環境の承認条件が適用される。

## 25-0で成功した一時構成

既存のビルド出力・キャッシュへの書き込み制限を避けるため、同じコミットの一時クローンで生成済みの VSIX を使った。作業ディレクトリは `dist/phase25-baseline/workspace/`。VS Code はキャッシュ済みの1.141.0の公開バイナリを `dist/phase25-baseline/vscode-C48aMU/installation/` へコピーしたものを使った。

一時ラッパー `phase25-webview-baseline.cjs` は、次の2点だけを既存の検証経路へ差し込んだ。

- VS Code の取得先は、`NERITA_BASELINE_VSCODE` が指すコピー内の `Code.exe` へ変更した。`@vscode/test-electron` の `downloadAndUnzipVSCode` の戻り値を差し替えた。
- 同じコミットで直前に生成した VSIX があることを確認した。`runPnpm(["run", "package:vsix"])` の再生成だけを省略した。

製品ソース、受け入れのアサーション、VSIX の展開、隔離プロファイル、VS Code 上の Webview の検証処理は維持した。生成済み VSIX が現在のソースと一致しない場合は、この再生成の省略を使わない。

次の PowerShell を上記の一時クローンで実行した。`exec_command` には `sandbox_permissions: "require_escalated"` を指定した。パスは作業ディレクトリから解決する。

```powershell
$env:CACHE_DIR = Join-Path (Get-Location) '..\isolated-cache'
$env:CLAUDE_CONFIG_DIR = Join-Path (Get-Location) '..\rtk-config'
$env:PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN = 'false'
$env:NERITA_BASELINE_VSCODE = Join-Path (Get-Location) '..\vscode-C48aMU\installation\Code.exe'
rtk proxy node phase25-webview-baseline.cjs
```

`PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` は、同じコミットの依存を再利用する一時クローンで、自動インストールを避けるために使用した。通常の開発設定を変更するための指定ではない。

## 再検証時に確認すること

成功の根拠は [実機受け入れ結果](../../dist/phase25-baseline/real-webview.json) の `webviewAcceptance.passed: true` と `exitCode: 0`。スクリーンショットと trace は `dist/phase25-baseline/workspace/dist/ui-review/nerita-distribution-lqYeQG/` にある。サンドボックス内の起動失敗だけから、Windows 側の ACL 変更が必要と判断しない。

これらの一時クローン・ラッパー・証跡は `dist/` の整理で失われる。存在を確認し、失われている場合は既存の検証入口で新しい VSIX と隔離環境を用意する。サンドボックス外でも失敗する場合は、その時点のエラーと対象パスを確認して原因を切り分ける。

## 本番 UI の検証

移行専用の一時検証コードと追加コマンドは削除した。VS Code 上の Webview の検証には既存の `pnpm test:webview` を使い、新規 VSIX と隔離プロファイルを用意する。サンドボックス内の起動で ACL エラーが出る場合は、上記の `sandbox_permissions: "require_escalated"` を指定する実行経路を試す。

本番 UI の監視は `pnpm watch`、表示・操作の回帰検証は既存の Storybook を使う。

## 維持する配布判断

- Vite の `base` は `./`、入口 JS は `index.js`、全 CSS は `index.css` とする。`cssCodeSplit: false` で動的な JS に付随する CSS も固定ファイルへ集約する。動的 JS は `chunks/`、画像・フォントは `assets/` へ出力し、VSIX の対象にも含める。
- Webview の入口は nonce 付きの module script とする。`script-src` は nonce の許可を維持し、画像・フォントは Webview の `cspSource` から読む。VS Code 上の Webview で動的 import が通ることを確認済み。外部サーバーや SvelteKit のルーティングは使わない。
- Vite は `nerita-source` 条件で既存の共有ソースを解決する。各画面は既存の Bridge へ接続する。製品 UI から `tests/scratch/` を参照しない。
- 本番の Host 集約先はビルド時に整理し、以前の試作資産を通常版の VSIX に混ぜない。watch 中の集約先では、表示済み画面が参照する旧チャンクを残す。
- `.svelte` の Lint・Storybook・ルート型検査は統合済み。TypeScript の既存規則と Phase 24 の独自規則を保持し、Svelte の正常・異常コードと通信境界も回帰テストで確認する。
