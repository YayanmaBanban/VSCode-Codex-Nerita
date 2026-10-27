<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { ComposerPart } from "@nerita/shared/composerContent";
	import { isRecord } from "@nerita/shared/validation";
	import ComposerInput from "../../../src/chat/composer/ComposerInput.svelte";
	import { createChatStoryBridge } from "../mocks/mockBridge";
	import "../../../src/chat/chat.css";

	const bridge = (() => createChatStoryBridge())();
	let locked = $state.raw(false);
	const setLocked = (
		value: typeof locked | ((previous: typeof locked) => typeof locked),
	) => {
		locked = typeof value === "function" ? value(locked) : value;
	};
	let requestId = $state.raw<string | undefined>(undefined);
	const setRequestId = (
		value:
			| typeof requestId
			| ((previous: typeof requestId) => typeof requestId),
	) => {
		requestId = typeof value === "function" ? value(requestId) : value;
	};
	let parts = $state.raw<ComposerPart[]>([
		{ id: "text", type: "text", text: "前文選択する本文後文" },
	]);
	const setParts = (
		value: typeof parts | ((previous: typeof parts) => typeof parts),
	) => {
		parts = typeof value === "function" ? value(parts) : value;
	};
</script>

<div
	class="p-4"
	role="presentation"
	oncontextmenu={(event) => {
		// Host と同様にメニューを開いた時点の識別子を保持し、古い通知も再現する。
		const context = event.currentTarget
			.querySelector("[data-vscode-context]")
			?.getAttribute("data-vscode-context");
		const parsed: unknown = isNonEmptyString(context)
			? JSON.parse(context)
			: undefined;
		setRequestId(
			isRecord(parsed) && typeof parsed.composerSelectionId === "string"
				? parsed.composerSelectionId
				: undefined,
		);
	}}
>
	<ComposerInput
		{bridge}
		{parts}
		onChange={setParts}
		onSubmit={() => {}}
		{locked}
	/>
	<button
		type="button"
		onclick={() => {
			if (typeof requestId === "string") {
				bridge.emit({ type: "ui/codeBlock", requestId });
			}
		}}
	>
		Hostのコードブロック化を通知
	</button>
	<button type="button" onclick={() => setLocked(!locked)}>
		入力ロック切替
	</button>
	<button
		type="button"
		onclick={() =>
			setParts([
				{
					id: "reference",
					type: "text",
					text: "前src後",
					references: [
						{
							offset: 1,
							path: {
								uri: "file:///D:/src",
								path: "src",
								name: "src",
								kind: "directory",
							},
						},
					],
				},
			])}
	>
		参照を含む下書き
	</button>
	<output aria-label="下書き">{JSON.stringify(parts)}</output>
</div>
