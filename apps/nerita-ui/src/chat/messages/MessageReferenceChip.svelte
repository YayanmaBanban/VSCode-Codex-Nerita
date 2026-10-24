<!-- 送信済みの構造化参照を、削除操作のないチップとして表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import type { ComposerTarget } from "@nerita/shared/composerTargets";
	import { pathText } from "@nerita/shared/composerReferences";
	import type { UiMessage } from "@nerita/shared/messages";
	import { mergeProps } from "bits-ui";
	import { referenceActionLabel } from "../composer/referencePresentation";
	import Tooltip from "../../ui/Tooltip.svelte";
	import ReferenceChipContent from "../ReferenceChipContent.svelte";

	let {
		path,
		send,
	}: {
		path: ComposerTarget;
		send?: ((message: UiMessage) => void) | undefined;
	} = $props();

	/** 参照の対象を Host の公開操作へ渡す。 */
	function openReference() {
		const requestId = crypto.randomUUID();
		if (path.kind === "changes") {
			send?.({ type: "changes/open", requestId, scope: path.scope });
		} else if (path.kind === "session") {
			send?.({
				type: "session/openReference",
				requestId,
				referencedSessionId: path.sessionId,
			});
		} else {
			const range = path.range ?? path.symbol?.range;
			send?.({
				type: "reference/open",
				requestId,
				uri: path.uri,
				...(range ? { range } : {}),
			});
		}
	}
</script>

<Tooltip content={pathText(path)}>
	{#snippet children({ props })}
		<button
			{...mergeProps(props, { onclick: openReference })}
			type="button"
			aria-label={referenceActionLabel(path)}
			disabled={!send}
			class={cn(
				"message-reference inline-flex max-w-full items-center gap-[5px] rounded-[5px] border border-solid",
				"border-panel-border bg-input px-[5px] py-[4px] align-middle text-[12px] leading-normal",
				"hover:bg-settings-hover",
				"focus-visible:outline-2 focus-visible:outline-focus",
				"[&_svg]:shrink-0",
			)}
		>
			<ReferenceChipContent {path} />
		</button>
	{/snippet}
</Tooltip>
