# プロジェクト固有の検証環境

検証方針の決定、テストや UI の変更・レビュー時に参照する。

以下のパスはリポジトリルートからの相対パス。

## テストの配置

実装中の動作確認や不具合の一時的な再現には `tests/scratch/` を使う。UI 操作スクリプトも対象とする。Git 管理に含めるが、通常のテスト実行・CI・Storybook の自動収集からは除外し、必要なファイルを明示して実行する。

継続して製品の回帰を検出するテストは `tests/product/`、`tests/vscode/`、`apps/nerita-ui/stories/` などに置く。共通の補助コードは `tests/support/` に置く。

## UI の検証環境

### Storybook の通信境界

テスト設定は `apps/nerita-ui/vitest.config.ts`、ストーリーは `apps/nerita-ui/stories/**/*.stories.tsx` に置く。ストーリーは製品のソースに対応する機能別の構成にし、検証開始時の実コンポーネントの状態を用意する。表示用データは `apps/nerita-ui/stories/chat/fixtures/` に置く。

`createStoryBridge()` が返すブリッジの `sent` に送信メッセージを記録する。`emit()` で検証側が指定した Extension Host の応答を配信し、`patchState()` で状態の差分を配信する。

表示デモの編集バッファと、本番の保存・信頼判定を区別する。承認後の完了状態を注入しても、実行許可の正しさを検証したことにはならない。

### VS Code 上の Webview の受け入れ検証

シナリオは `tests/vscode/webview.cjs` と `tests/vscode/account.cjs` に置く。`config/test-distribution.cjs` で VSIX を新規生成し、`config/test-webview.cjs` で専用プロファイルを使って VS Code を起動する。

モデル応答だけをローカルの HTTP サーバーで代替し、画面操作は実際の Extension Host で処理する。承認前にファイルが作られていないこと、承認後のファイル内容、停止後にファイルが作られていないことを確認する。

VS Code の拡張テストモードは確認ダイアログを禁止するため、通常の開発用 Extension Host と一時的な補助拡張で実行する。専用プロファイルの `window.dialogStyle` は `custom` に設定する。利用者のプロファイルには拡張機能をインストールせず、設定も変更しない。

## 実行コマンド

- `pnpm storybook` はストーリーを開いて確認する場合に使う。
- `pnpm test:local` は日常のローカル検証に使う。対象テストを選ぶ場合は `pnpm test:product <ファイル名の一部>` を使う。
- `pnpm test:regressions` は通常版の成功と、意図的に不具合を加えた実装でのアサーション失敗を確認する。
- `pnpm test:distribution` は今回生成した VSIX を展開し、同梱 SDK と実際の Extension Host を検証する。
- `pnpm test:windows` は新規 VSIX の Codex を使い、実際の Windows サンドボックスの書き込み制限と停止時の子孫プロセスの終了を検証する。準備済みの `elevated` モードのサンドボックスと既存の `CODEX_HOME` を使い、準備不足を成功扱いにしない。新規作業領域だけを書き込み対象にする。
- `pnpm test:webview` は VS Code 上の Webview の信頼操作・再接続・承認・停止・認証の取り消し・設定の切り替え・履歴の復元を検証する。
- `pnpm test:external` は導入済み Pi 拡張の受け入れ検証に使う。導入先は `NERITA_EXTERNAL_AGENT_DIR`、`PI_CODING_AGENT_DIR`、ホーム内の `.pi/agent` の順で選ぶ。Web 拡張の検証では公開 GitHub リポジトリを取得し、未導入や通信失敗を成功扱いにしない。
- `pnpm test:storybook` は Storybook の表示・操作を検証する。

## UI レビューの成果物

スクリーンショットの撮影とエラー収集には、対象テストシナリオ内で Playwright の API を使う。VS Code 上の Webview の画像・トレースと、明暗テーマでの表示幅・背景色・文字色は `dist/ui-review/nerita-distribution-*/` 配下へ実行ごとに保存する。表示幅が狭い状態で、テーマの適用と操作ボタンの表示を確認する。現在の受け入れ検証では動画や HTML レポートを生成しない。

トレースは次の形式で開ける。

```sh
pnpm exec playwright show-trace <今回の成果物ディレクトリ>/trace.zip
```
