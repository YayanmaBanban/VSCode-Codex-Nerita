// 外部から届いた HTML・画像・URL を、文字として安全に表示するための検証入力。
export const unsafeMarkdown =
	'<script>globalThis.__markdownInjection = true</script>\n\n<img src="https://asset.invalid/pixel" onerror="alert(1)">\n\n![代替テキスト](https://asset.invalid/remote.png)\n\n[通常](https://example.invalid) [実行不可](javascript:alert%281%29) [文字参照](javascript&#58;alert%281%29) [data](data:text/html,unsafe)\n\n- [x] 完了\n- [ ] 未完了';
