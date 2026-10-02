# プロジェクト固有の検証環境

検証方針の決定、テストや UI の変更・レビュー時に参照する。汎用の判断基準と確認手順は [開発ガイドライン](../skills/development-guidelines/SKILL.md) に従う。以下のパスはリポジトリルートからの相対パス。

## テストの配置

実装中の動作確認や不具合の一時的な再現には `tests/scratch/` を使う。UI 操作スクリプトも対象とする。Git 管理に含めるが、通常のテスト実行・CI・Storybook の自動収集からは除外し、必要なファイルを明示して実行する。各検証には目的と実行方法を残す。確認が終わったものや用途を失ったものは削除してよく、恒久的な保守や代わりのテストの追加を求めない。

継続して製品の回帰を検出するテストは、`tests/scratch/` 以外の正式な配置に置く。対象は `tests/product/`、`tests/vscode/`、`apps/nerita-ui/stories/` など。追加時には、検出する具体的な不具合と実行タイミング・コマンドを明確にする。一時検証を作ったことだけを理由に正式な配置へ移さない。共通の補助コードは `tests/support/` などに置き、利用するテストとともに維持・整理する。

## UI の検証環境

### Storybook の通信境界

設定は `apps/nerita-ui/vitest.config.ts`、ストーリーは `apps/nerita-ui/stories/` に置く。表示用データは `apps/nerita-ui/stories/chat/fixtures/` に置く。

`createStoryBridge()` の `sent` で送信を記録し、`emit()` と `patchState()` で検証側が指定する Host 応答を配信する。

1. 実 UI を操作する。
2. 送信記録の種類・識別子・入力内容を確認する。
3. 固定の Host 応答を注入する。
4. 応答後の表示と操作可否を確認する。

承認後の完了状態を注入しても、実行許可の正しさを検証したことにはならない。共通ブリッジで、承認判断・認証・保存・バックエンド切替などの製品処理を再実装しない。送信された選択肢や識別子を補正しない。

表示デモの編集バッファと、本番の保存・信頼判定を区別する。非同期処理は応答前・成功後・失敗後の必要な状態を明示し、即時成功だけで受付待ちを隠さない。

### 実 Webview の受入

シナリオは `tests/vscode/webview.cjs` と `tests/vscode/account.cjs` に置く。起動は `config/test-distribution.cjs` と `config/test-webview.cjs` が担当する。

本番の状態を直接書き換えず、画面操作と公開コマンドを使う。モデル応答はローカル HTTP で代替する。承認前にファイルが作られていないこと、承認後のファイル内容、停止後にファイルが作られていないことなど、表示以外の結果も確認する。

VS Code の拡張テストモードは確認ダイアログを禁止するため、通常の開発 Host と一時的な補助拡張で実行する。専用プロファイルでは確認ダイアログを `custom` に設定する。利用者の拡張機能や設定へインストールしない。

生成物・一時領域・プロセスを実行ごとに分離し、準備失敗や結果ファイルの未生成を成功扱いにしない。検証終了と期限切れでは専用プロセスを回収する。要素の役割や名前で操作し、対象の状態が成立するまで待つ。

## 現在の構成

- ストーリー：`apps/nerita-ui/stories/**/*.stories.tsx`。実機側に対応する機能別の構成で、確認を始めるときの実コンポーネントの状態を用意する。
- 実 Webview の受入：`tests/vscode/webview.cjs`。展開 VSIX の信頼操作・再接続・承認・停止を実 Host へ通す。
- 撮影・エラー収集：対象テストシナリオ内で Playwright の API を使用する。
- 実行設定：`config/test-distribution.cjs` と `config/test-webview.cjs`。VSIX を新規生成し、専用プロファイルで起動する。

対象はテストシナリオから確認する。

## 実行コマンド

対象ストーリーを開く場合は `pnpm storybook` を使う。
日常のローカル検証は `pnpm test:local`、担当を選ぶ場合は `pnpm test:product <ファイル名の一部>` を使う。
`pnpm test:regressions` は通常版の成功と、狙った実装破壊によるアサーション失敗を確認する。
`pnpm test:distribution` は今回生成した VSIX を展開し、同梱 SDK と実 Extension Host を検証する。
`pnpm test:windows` は新規 VSIX の Codex を使い、実 Windows サンドボックスの書込み境界と停止時の子孫プロセス回収を検証する。準備済みの elevated サンドボックスと既存の `CODEX_HOME` を使用し、未準備を成功扱いにしない。新規作業領域だけを書込み対象にする。
`pnpm test:webview` は新規 VSIX と専用プロファイルで、実 Webview の信頼操作・再接続・承認・停止・認証取消し・設定切替・履歴復元を検証する。モデルの HTTP 応答だけを代替し、画面操作の結果を実ファイルでも確認する。明暗テーマと狭幅の適用値、画像とトレースは実行ごとに保存する。
`pnpm test:external` は導入済み Pi 拡張の受入検証に使う。導入先は `NERITA_EXTERNAL_AGENT_DIR`、`PI_CODING_AGENT_DIR`、ホーム内の `.pi/agent` の順で選ぶ。Web 拡張の検証には公開 GitHub リポジトリの取得を伴い、未導入・通信失敗を成功扱いにしない。
Storybook の表示・操作は `pnpm test:storybook` で別に実行する。ローカル検証の成功を、実 UI・OS・外部サービスの受入へ読み替えない。

## UI レビューの成果物

実 Webview の画像とトレースは `dist/ui-review/nerita-distribution-*/` 配下へ実行ごとに保存する。現在の受入は動画や HTML レポートを生成しない。過去のレポートを今回の成功として扱わない。

失敗時も最後の画面を残す。トレースは次の形式で開ける。

```sh
pnpm exec playwright show-trace <今回の成果物ディレクトリ>/trace.zip
```
