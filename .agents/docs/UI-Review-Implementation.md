# UI レビューの実装・実行

シナリオや実行環境を追加・変更する場合に参照します。確認方針は [UI レビュー](UI-Review-Guide.md) にまとめています。

以下は本プロジェクトの実装例です。他プロジェクトではコマンド・パス・ストーリー ID・検証データ・CI 設定を実装に合わせて調整してください。文書だけで実行基盤は導入できません。「役割」内のパスは `tests/e2e/` を基準にしています。コード例は `tests/e2e/ui-review/` に置くテストシナリオを想定しています。

```sh
pnpm ui-review
pnpm ui-review chat
pnpm ui-review tool-cards
pnpm exec playwright show-report dist/ui-review/report
```

実行時に Storybook をビルドし、既定では6007番ポートのプレビューサーバーで対象ストーリーを操作・撮影します。既存のサーバーは再利用しません。

## 役割

- ストーリー：観察開始状態。実際のコンポーネントを使い、Host との通信はモックの通信ブリッジに置き換える。
- `ui-review/*.spec.ts`：対象固有の操作、状態待ち、必要なアサーション。
- `config/ui-review.config.ts`：共通ビューポート（420×820）、Storybook 起動、Chromium、動画・トレース・レポート。

## 対象の追加

ストーリーを追加し、その ID を使ってテストシナリオを作ります。

```ts
import { test, expect } from "@playwright/test";

test("対象のシナリオ", async ({ page }, info) => {
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	const button = page.getByRole("button", { name: "新しいチャット" });
	await expect(button).toBeVisible();
	await info.attach("initial", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	await button.hover();
	await info.attach("hover", {
		body: await page.screenshot(),
		contentType: "image/png",
	});
});
```

添付名は撮影状態が分かる名前にします。画像を明示的に保存する場合は `info.outputPath()` を使い、同名で上書きしないようにします。対象固有の非同期処理はテストシナリオ側で待ちます。撮影だけでネットワークやアプリの処理完了を判断しません。

## 成果物

`dist/ui-review/test-results` の各シナリオフォルダに画像・動画・トレースを保存します。状態ごとの画像は `info.attach()` でレポートへ添付します。`console` と `page` の `error` の収集・検証は対象テストシナリオに記述し、必要なエラー情報をレポートへ添付します。

HTML レポートは `dist/ui-review/report` に保存します。成功時も画像・動画・トレースを残します。再実行すると前回の成果物は置き換わるため、変更前後を比較する場合は実行前に別の場所へ保存してください。

対象シナリオは `tests/e2e/ui-review/*.spec.ts` を確認してください。画像の合否は人間または AI が判断します。静止画撮影時のアニメーション設定はテストシナリオごとに確認し、動画と静止画で動きの扱いが異なる場合は区別します。
