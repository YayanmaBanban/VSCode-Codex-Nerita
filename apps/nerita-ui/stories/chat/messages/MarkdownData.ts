// 個人の環境に依存しない表示データと、Host 通知を注入する操作。
export function sampleFile(relativePath: string): URL {
	return new URL(relativePath, "file:///");
}
export const markdown = [
	"## 変更内容",
	"**太字**と*斜体*、~~取り消し~~、`inline code`を表示します。\n改行も保持します。",
	"- 項目A\n  - 子項目\n- 項目B",
	"1. 確認する\n2. 実行する",
	"> 引用した説明です。",
	"- [x] 完了\n- [ ] 未完了",
	"| 項目 | 状態 |\n| --- | --- |\n| Markdown | 対応済み |",
	"[ドキュメント](https://example.com/docs)",
	`[Code-Implementation.md](${sampleFile(".agents/docs/Code-Implementation.md").pathname})`,
	`[AGENTS.md](${sampleFile("AGENTS.md").href})`,
	`[日本語](<${decodeURI(sampleFile("日本語 sample.md").pathname)}>)`,
	"[コマンド](command:workbench.action.closeWindow)",
	'```ts\nconst message = "<strong>文字列</strong>";\nconst longPath = "project/very/long/path/to/source/file.ts";\n```',
	'<b>HTMLは文字列</b>\n<script>alert("実行しない")</script>',
	"[無効なリンク](javascript:alert%281%29)",
].join("\n\n");
