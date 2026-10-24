# プロジェクト固有の UI 実装

Webview UI の作成・変更時に参照する。

## 選択コントロール

標準の `<select>` コントロールの代わりに、`ConfigControl` コンポーネントを使用する。

- 実装は `apps/nerita-ui/src/chat/composer/ConfigControl.svelte` にある。
- 枠を付ける場合は `appearance="field"` を指定する。
