<!-- 組み込み保護の判定を、拒否と承認の二択で編集する。 -->
<script lang="ts">
	import { cn } from "cnfast";

	let {
		name,
		description,
		action,
		disabled,
		onChange,
	}: {
		name: string;
		description: string;
		action: "deny" | "ask";
		disabled: boolean;
		onChange: (value: "deny" | "ask") => void;
	} = $props();
</script>

<div
	class="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border py-3"
>
	<div class="min-w-0 flex-1 basis-52">
		<h4 class="m-0 text-[14px] font-medium">{name}</h4>
		<p class="mt-1 mb-0 break-words text-muted">{description}</p>
	</div>
	<div class="flex shrink-0 items-center gap-2">
		<span class={action === "deny" ? "text-tool-error" : "text-muted"}>
			拒否
		</span>
		<button
			type="button"
			role="switch"
			aria-label={`${name}を承認にする`}
			aria-checked={action === "ask"}
			{disabled}
			onclick={() => onChange(action === "ask" ? "deny" : "ask")}
			class={cn(
				"group relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input-border bg-input p-1 text-primary-text",
				"focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 aria-checked:bg-primary",
			)}
		>
			<span
				class="size-4 rounded-full bg-foreground group-aria-checked:translate-x-4"
				aria-hidden="true"
			></span>
		</button>
		<span class={action === "ask" ? "text-foreground" : "text-muted"}>
			承認
		</span>
	</div>
</div>
