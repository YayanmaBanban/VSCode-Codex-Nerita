# UIレビューの実装・実行

シナリオや実行環境を追加・変更する場合に参照します。確認方針は [UIレビュー](UI-Review-Guide.md) にまとめています。以下のパスはリポジトリルート基準です。

## 実装と設定

| 役割 | ファイル |
| --- | --- |
| Story の検出・アドオン | `config/storybook/main.ts` |
| プレビューの共通設定 | `config/storybook/preview.tsx` |
| Story のブラウザテスト | `config/vitest.config.ts` |
| UIレビューの起動・保存先・ブラウザ | `tests/e2e/config/ui-review.config.ts` |
| チャットの操作・撮影 | `tests/e2e/ui-review/chat.spec.ts` |
| Playwright の型設定 | `tests/e2e/tsconfig.json` |

`tests/e2e/specs/example.spec.ts` は外部サイト向け初期サンプルで、UIレビュー対象外です。`test:storybook` はStoryのブラウザテスト、`ui-review` はStorybookを外から操作・撮影するPlaywright Testとして分けます。VS Code APIとの結合確認は拡張機能テスト側で扱います。

## シナリオの追加

1. 実コンポーネントと観察開始状態を表すStoryを `src/` 配下に追加し、Storybookの検出対象に含める。
2. 起動したStorybookの `/index.json` でStory IDを確認する。現在のチャットは `chat-app--*` を使用する。
3. `tests/e2e/ui-review/` に `*.spec.ts` を作り、`@playwright/test` から `test`・`expect` をimportする。
4. `page.goto()` で `/iframe.html?id=<Story ID>&viewMode=story` を開き、意味のある状態をassertionで待つ。
5. 必要なフォント・画像のロードを待ち、`page.screenshot()` の画像を `testInfo.attach()` で名前付き添付する。
6. console/page errorを収集し、シナリオ終了時に検証する。UIに合わせて操作と撮影を追加する。

共通fixtureはありません。現在のspecは処理を直接記述しています。複数シナリオで同じ処理が必要になった場合に共通化を検討してください。JSON保存やアニメーションの時間別撮影も未実装です。

## 起動と成果物

```sh
pnpm ui-review
pnpm ui-review:chat
pnpm ui-review:report
```

設定の `webServer` はリポジトリルートからStorybookを起動し、`http://127.0.0.1:6006/index.json` を待ちます。対象Storyの存在や描画完了はspecで別途確認します。

Chromium・420×820を基準に実行します。狭い幅はspecで320×760を指定します。画像・動画・traceは成功時も保存し、出力先は `dist/ui-review/test-results/` と `dist/ui-review/report/` です。添付画像はHTMLレポートから確認します。再実行前に比較用成果物を保全してください。

型検査は `pnpm exec tsc -p tests/e2e/tsconfig.json`、対象Lintは `pnpm exec eslint tests/e2e/config tests/e2e/ui-review` で実行できます。テスト検出だけを確認する `pnpm ui-review --list` は、操作・描画の検証とは区別します。

## CIを追加する場合

現在、UIレビュー用のGitHub Actionsワークフローはありません。追加する場合は依存関係とChromiumを準備し、対象Storyが存在することを確認してUIレビューを実行します。失敗時も成果物を取得できるようにし、保持期間や並列実行の扱いはワークフローで明示してください。ローカルの成功だけでCIの動作確認済みとは扱いません。
