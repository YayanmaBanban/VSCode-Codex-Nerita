# プロジェクト固有の UI 実装

Webview UI の作成・変更時に参照する。

## ボタン

テキストを含むボタン要素には、文字色として `text-primary-text` を指定する。

## 選択コントロール

標準の `<select>` コントロールの代わりに、`ConfigControl` コンポーネントを使用する。

- 実装は `apps/nerita-ui/src/chat/composer/ConfigControl.svelte` にある。
- 枠を付ける場合は `appearance="field"` を指定する。

## ツールチップとヘルプ

- ツールチップの表示には、標準の `title` 属性の代わりに `apps/nerita-ui/src/ui/Tooltip.svelte` の `Tooltip` コンポーネントを使用する。
- 見出しや入力項目のラベルに説明を付ける場合は、`apps/nerita-ui/src/ui/HelpButton.svelte` の `HelpButton` コンポーネントを使用する。

## 確認ダイアログ

`ConfirmationDialog` では、推奨する操作のボタンを一番左に配置し、背景色に `bg-primary` を指定する。

それ以外のボタンには `ButtonCurtain` を使用し、操作に応じてカーテンの背景色を指定する。

| 操作 | カーテンの背景色 |
| --- | --- |
| 破棄・キャンセルなど | `bg-red-300` |
| 拒否・中断など | `bg-yellow-300` |
| それ以外の操作 | `bg-green-300` |
