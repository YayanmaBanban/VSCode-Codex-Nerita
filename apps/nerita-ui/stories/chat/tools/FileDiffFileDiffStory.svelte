<!-- 既存の通信境界と操作を Svelte の実コンポーネントで確認する。 -->
<svelte:options runes={true} />

<script lang="ts">
	import type { UiMessage } from "@nerita/shared/messages";
	import EditingFiles from "../../../src/chat/tools/EditingFiles.svelte";
	import "../../../src/chat/chat.css";
	import { path, oldLines, newLines } from "./FileDiffData";

	let request = $state.raw<UiMessage | undefined>(undefined);
	function setRequest(
		value: typeof request | ((current: typeof request) => typeof request),
	) {
		request = typeof value === "function" ? value(request) : value;
	}
	const cwd = new URL("/workspace/project", window.location.href).pathname;
</script>

<main class="p-4">
	<EditingFiles
		tool={{
			id: "diff",
			title: "Editing files",
			kind: "edit",
			status: "completed",
			paths: [path],
			content: [
				{
					type: "unifiedDiff",
					path,
					diff: "--- a/BorderBeam.tsx\n+++ b/BorderBeam.tsx\n@@ -72 +72 @@\n-/** マスクで内側を抜き、光の軌道を親要素の外周に限定する。 */\n+/** マスクで内側を抜き、親要素の外周に沿って動く光を表示する。 */\n@@ -92 +92,2 @@\n-// 枠線を持つマスク要素で overflow を切ると...\n+// マスク要素に overflow-hidden を指定すると...\n+// 外側の要素で光のはみ出しを切り取り...\n",
				},
				{
					type: "diff",
					path,
					oldText: oldLines.join("\n"),
					newText: newLines.join("\n"),
				},
				{
					type: "unifiedDiff",
					path: "added.ts",
					diff: "@@ -0,0 +1,2 @@\n+first\n+second\n",
				},
				{
					type: "unifiedDiff",
					path: "deleted.ts",
					diff: "@@ -10,2 +9,0 @@\n-first\n-second\n",
				},
				{
					type: "unifiedDiff",
					path: "shifted.ts",
					diff: "@@ -10,2 +15,2 @@\n-old\n+new\n context\n\\ No newline at end of file\n",
				},
			],
		}}
		{cwd}
		send={setRequest}
	></EditingFiles>
	<output aria-label="送信した要求" class="block [overflow-wrap:anywhere]">
		{request && JSON.stringify(request)}
	</output>
</main>
