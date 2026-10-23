<!-- 承認の要点を常時表示し、長い実行情報を開閉できる詳細にまとめる。 -->
<script lang="ts">
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { cn } from "cnfast";
	import type { PermissionPresentation } from "@nerita/shared/permission";

	let { permission }: { permission: PermissionPresentation } = $props();
	let detailsOpen = $state(false);
	const detailsId = $props.id();

	import PermissionCode from "./PermissionCode.svelte";
	import PermissionFields from "./PermissionFields.svelte";
</script>

<div class="min-w-0 text-[13px] leading-[1.7]">
	<h2
		class="my-[12px] text-[14px] font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap"
	>
		{permission.title}
	</h2>
	{#if permission.cwd !== undefined}
		<PermissionFields
			fields={[
				{
					id: "cwd",
					label: "作業フォルダ",
					value: permission.cwd,
					display: "text",
				},
			]}
		/>
	{/if}
	<PermissionFields fields={permission.fields ?? []} />
	{#if permission.details && permission.details.length > 0}
		<div
			class="my-[12px] min-w-0 rounded-[6px] border border-solid border-panel-border p-[10px]"
		>
			<button
				type="button"
				aria-expanded={detailsOpen}
				aria-controls={detailsId}
				onclick={() => {
					detailsOpen = !detailsOpen;
				}}
				class="flex w-full cursor-pointer items-center gap-[4px] border-0 bg-transparent p-0 text-left text-muted"
				><ChevronRight
					aria-hidden="true"
					size={14}
					class={cn(
						"shrink-0 transition-transform duration-[220ms] ease-out motion-reduce:transition-none",
						detailsOpen && "rotate-90",
					)}
				/>詳細 ({permission.details.length})</button
			>
			<div
				id={detailsId}
				inert={!detailsOpen}
				aria-hidden={!detailsOpen}
				class={cn(
					"grid transition-[grid-template-rows] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
					detailsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div class="min-h-0 overflow-hidden">
					<PermissionFields fields={permission.details} />
				</div>
			</div>
		</div>
	{/if}
	{#if permission.command !== undefined}
		<div class="my-[12px] min-w-0">
			<div class="mb-[6px] text-muted">コマンド</div>
			<PermissionCode label="コマンド" value={permission.command} />
		</div>
	{/if}
</div>
