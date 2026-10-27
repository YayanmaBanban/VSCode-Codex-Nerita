<!-- 画像パスは外部取得せず、Host の参照を開く操作として表示する。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	let {
		tool,
		send,
		cwd,
	}: {
		tool: ToolSummary;
		send?: ((message: UiMessage) => void) | undefined;
		cwd?: string | null | undefined;
	} = $props();
	/** 相対パスは実行時の作業ディレクトリで解決し、予約文字をエスケープする。 */
	function fileUri(path: string) {
		let normalized = path.replaceAll("\\", "/");
		if (!normalized.startsWith("/") && !/^[a-z]:\//i.test(normalized)) {
			const directory = tool.cwd ?? cwd;
			if (!isNonEmptyString(directory)) {
				return undefined;
			}
			normalized = `${directory.replaceAll("\\", "/").replace(/\/$/, "")}/${normalized}`;
		}
		let slashes = "///";
		if (normalized.startsWith("/")) {
			slashes = "//";
		}
		if (normalized.startsWith("//")) {
			slashes = "";
		}
		return `file:${slashes}${normalized
			.split("/")
			.map(encodeURIComponent)
			.join("/")
			.replace(/^([a-z])%3A/i, "$1:")}`;
	}
</script>

{#each tool.paths as path, index (index)}
	{@const uri = fileUri(path)}
	<div>
		{#if isNonEmptyString(uri) && send}
			<a
				class="[overflow-wrap:anywhere] text-link underline underline-offset-2"
				href={uri}
				onclick={(event) => {
					event.preventDefault();
					send({
						type: "reference/open",
						requestId: crypto.randomUUID(),
						uri,
					});
				}}
			>
				{path}
			</a>
		{:else}
			<span class="[overflow-wrap:anywhere]">{path}</span>
		{/if}
	</div>
{/each}
