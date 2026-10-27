# プロジェクト固有の検証環境

検証方針の決定、テストや UI の変更・レビュー時に参照する。

以下のパスはリポジトリルートからの相対パスとする。

## テストの配置

実装中の動作確認や不具合の一時的な再現には `tests/scratch/` を使う。一時的な UI 操作スクリプトもここに置く。Git 管理に含めるが、通常のテスト実行・CI・Storybook の自動収集からは除外し、必要なファイルを明示して実行する。

継続して製品の回帰を検出するテストは `tests/product/`、`tests/vscode/`、`apps/nerita-ui/stories/` などに置く。共通の補助コードは `tests/support/` に置く。

## UI の検証環境

### Storybook の通信境界

テスト設定は `apps/nerita-ui/vitest.config.mts`、ストーリーは `apps/nerita-ui/stories/**/*.stories.ts` に置く。必要な状態や操作ラッパーは、ストーリーと同じ領域の `.svelte` ファイルに置く。

ストーリーは製品のソースと同じ機能別の構成にし、製品コンポーネントに検証開始時の状態を与える。表示用データは `apps/nerita-ui/stories/chat/fixtures/` に置く。

`pnpm check` は製品・ストーリーの `svelte-check` と TypeScript の検査を含む。Svelte の警告も修正する。Svelte コンパイラーは Storybook の Vite 設定に一度だけ追加する。

`createStoryBridge()` が返すブリッジは、`sent` に送信メッセージを記録する。検証側は `emit()` で指定した Extension Host の応答を配信し、`patchState()` で状態の差分を配信する。

表示デモの編集バッファと、本番の保存・信頼判定を区別する。承認後の完了状態を注入しても、実行許可の正しさを検証したことにはならない。

### VS Code 上の Webview の受け入れ検証

シナリオは `tests/vscode/webview.cjs` と `tests/vscode/account.cjs` に置く。`config/test-distribution.cjs` で VSIX を新規生成し、`config/test-webview.cjs` で専用プロファイルを使って VS Code を起動する。

モデル応答だけをローカルの HTTP サーバーで代替し、画面操作に伴う処理は実際の Extension Host で行う。次の点を確認する。

- 承認前にファイルが作られていないこと
- 承認後のファイル内容
- 停止後にファイルが作られていないこと

VS Code の拡張テストモードは確認ダイアログを禁止するため、通常の開発用 Extension Host と一時的な補助拡張で実行する。専用プロファイルの `window.dialogStyle` は `custom` に設定する。利用者のプロファイルには拡張機能をインストールせず、設定も変更しない。

#### ACL エラーが発生した場合の起動

サンドボックス内からの起動で ACL エラーが発生する場合は、サンドボックス外からの起動を試す。`exec_command` には `sandbox_permissions: "require_escalated"` を指定する。実行するコマンドは次のとおり。

```powershell
rtk proxy pnpm.cmd run test:webview vscode-bridge webview-backend
```

この指定は Windows の管理者起動や ACL 変更を意味しない。検証では新規 VSIX と隔離プロファイルを使用する。過去の一時ラッパーや生成済み VSIX は、そのまま再利用しない。

## 実行コマンド

| コマンド | 用途・確認内容 |
| --- | --- |
| `pnpm storybook` | ストーリーを開いて確認する。 |
| `pnpm test:local` | 日常のローカル検証を行う。対象テストを選ぶ場合は `pnpm test:product <ファイル名の一部>` を使う。 |
| `pnpm test:regressions` | 通常の実装でテストが成功することと、意図的に不具合を加えた実装でアサーションが失敗することを確認する。 |
| `pnpm test:distribution` | 実行時に生成した VSIX を展開し、同梱 SDK と実際の Extension Host を検証する。 |
| `pnpm test:windows` | 新規 VSIX の Codex を使い、実際の Windows サンドボックスの書き込み制限と、停止時に子孫プロセスが終了することを検証する。 |
| `pnpm test:webview` | VS Code 上の Webview の信頼操作・再接続・承認・停止・認証の取り消し・設定の切り替え・履歴の復元を検証する。 |
| `pnpm test:external` | 導入済み Pi 拡張の受け入れ検証を行う。 |
| `pnpm test:storybook` | Storybook の表示・操作を検証する。 |

`pnpm test:windows` は、準備済みの `elevated` モードのサンドボックスと既存の `CODEX_HOME` を使う。準備不足で実行できない場合は成功扱いにせず、書き込み先は新規作業領域に限定する。

`pnpm test:external` で使う Pi 拡張の導入先は、次の優先順位で選ぶ。

1. `NERITA_EXTERNAL_AGENT_DIR`
2. `PI_CODING_AGENT_DIR`
3. ホーム内の `.pi/agent`

Web 拡張の検証では公開 GitHub リポジトリを取得し、未導入や通信失敗を成功扱いにしない。

## UI レビューの成果物

スクリーンショットの撮影とエラー収集には、対象テストシナリオ内で Playwright の API を使う。VS Code 上の Webview の画像・トレースと、明暗テーマでの表示幅・背景色・文字色は `dist/ui-review/nerita-distribution-*/` 配下へ実行ごとに保存する。

表示幅が狭い状態で、テーマの適用と操作ボタンの表示を確認する。現在の受け入れ検証では動画や HTML レポートを生成しない。

トレースは次の形式で開ける。

```sh
pnpm exec playwright show-trace <今回の成果物ディレクトリ>/trace.zip
```
