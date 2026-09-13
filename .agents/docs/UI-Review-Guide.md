# UIレビューの実行ガイド

React UIの表示・操作・アニメーションを変更する場合、またはUIレビューを依頼された場合に参照します。テストの成功に加え、生成画像を実際に開いて確認してください。文書のみの変更や表示・操作に影響しない内部整理では、UIレビューは不要です。

## 現在の構成

- Story の検出設定：`config/storybook/main.ts`。対象は `src/**/*.stories.@(js|jsx|mjs|ts|tsx)`。
- シナリオ：`tests/e2e/ui-review/chat.spec.ts`。
- 実行設定：`tests/e2e/config/ui-review.config.ts`。Chromium、420×820、Storybook の自動起動を設定。狭い幅のシナリオは320×760。
- 撮影：spec 内の `page.screenshot()` と `testInfo.attach()`。共通fixtureやJSON保存処理は未実装。

`src/webview/chat/ChatApp.stories.tsx` の `chat-app--*` が対象です。送信・承認と拒否・停止・再接続・IME・狭い幅・明暗テーマを確認します。以前の画像を現在の結果として扱わないでください。

シナリオや実行環境を変更する場合は [実装ガイド](UI-Review-Implementation.md) を参照します。

## 実行

```sh
pnpm ui-review
pnpm ui-review:chat
pnpm ui-review:report
```

`pnpm ui-review chat` でもspecのパスを絞り込めます。0件の実行を成功したレビューとして扱わないでください。

Storybook は6006番ポートで自動起動します。ローカルでは起動済みサーバーを再利用するため、このプロジェクトのStorybookであることを確認してください。CIでは再利用しません。

## 変更前後の確認

1. 対象の実装・Story・specが存在し、同じ状態を参照していることを確認する。
2. 変更前のレビューを実行するか、現在のコード・条件と一致する保存済み結果を確保する。既存の失敗は変更由来の失敗と区別する。
3. `dist/ui-review/test-results/` と `dist/ui-review/report/` を、重複しない `dist/ui-review-history/<作業名>/before/` 配下へコピーする。再実行で前回の成果物が置き換わるため、既存の比較資料を保全する。
4. UI・Story・specを更新し、対象のレビューを実行する。共通部品の変更では利用側も確認する。
5. 画像を開き、文字の欠け・重なり・余白・位置・色・無効状態・フォーカスを確認する。操作の流れは動画も使って確認する。
6. console/page errorとassertionを確認し、不具合を修正した場合は影響するレビューを再実行する。
7. 実行したシナリオ、確認した状態、成果物の場所、未確認事項を報告する。

対象シナリオがなければ必要なStoryとspecを追加します。文言や装飾だけなど追加が不要な変更でも、実画面または生成画像で確認します。実行できない場合は代替の確認方法と限界を示してください。

## 撮影と成果物

specは会話・承認・長文などの表示を待ち、画像をHTMLレポートへ添付します。テスト終了時の画像・動画・traceも成功時から保存する設定です。

- `dist/ui-review/test-results/`：テスト終了時の画像、動画、traceなど。
- `dist/ui-review/report/`：途中の状態の添付画像も確認できるHTMLレポート。

対象固有の画像ロードや非同期状態はspecで待ちます。固定時間待ちだけで安定性を判断せず、押下中の撮影ではマウスを押した状態を維持してください。JSONのチェックポイント記録や画像の自動差分判定は未実装で、PASSは見た目の品質保証を意味しません。

## アニメーション・性能の確認

既存specの静止画は `animations: "disabled"` で撮影します。任意のJavaScriptアニメーションの時間制御ではありません。変更では始点・途中・終点を再現できる対象固有の方法を用意し、確認できない中間状態は未確認と報告してください。

性能問題では利用可能な計測手段で条件を揃えて確認します。PlaywrightのtraceをブラウザのPerformance記録と同一視せず、見た目だけから性能改善を断定しないでください。
