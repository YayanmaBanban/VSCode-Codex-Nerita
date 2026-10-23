<!-- 承認の短い値を二列に揃え、長いコードやパスは全幅で表示する。 -->
<script lang="ts">
	import type { PermissionField } from "@nerita/shared/permission";
	import PermissionCode from "./PermissionCode.svelte";

	let { fields }: { fields: PermissionField[] } = $props();
</script>

{#if fields.length > 0}
	<dl
		class="my-[12px] grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-[12px] gap-y-[8px]"
	>
		{#each fields as field (field.id)}
			<div
				class={field.display === "code" || field.value.length > 64
					? "col-span-2 min-w-0"
					: "contents"}
			>
				<dt class="[overflow-wrap:anywhere] text-muted">
					{field.label}
				</dt>
				<dd
					class="m-0 min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap"
				>
					{#if field.display === "code"}
						<PermissionCode
							label={field.label}
							value={field.value}
						/>
					{:else}{field.value}{/if}
				</dd>
			</div>
		{/each}
	</dl>
{/if}
