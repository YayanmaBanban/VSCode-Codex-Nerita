<!-- Codex の権限・承認設定を編集し、非表示の承認者の値は保持する。 -->
<script lang="ts">
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { cn } from "cnfast";
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		agentEditSchema,
		type AgentEdit,
	} from "@nerita/shared/agentManager/config";
	import {
		codexSandboxChoices,
		codexReviewerChoices,
		permissionControl,
	} from "@nerita/shared/settingsCards";
	import SliderCard from "../contributions/SliderCard.svelte";
	import { managerOption } from "../agentManager/modelOptions";
	import ApprovalPolicyField from "./ApprovalPolicyField.svelte";

	let {
		edit,
		onChange,
		disabled,
	}: {
		edit: AgentEdit;
		onChange: (edit: AgentEdit) => void;
		disabled: boolean;
	} = $props();
	let open = $state(false);
	const id = $props.id();
	let mode = $derived(
		managerOption(
			"mode",
			"サンドボックスモード",
			edit.sandboxMode,
			codexSandboxChoices,
			false,
		),
	);
	let reviewer = $derived(
		managerOption(
			"approvals_reviewer",
			"承認者",
			edit.approvalsReviewer,
			codexReviewerChoices,
			false,
		),
	);
	/** 選択した権限設定を検証し、他のエージェント設定を保って親へ伝える。 */
	function change(key: string, value: string) {
		onChange(
			key === "mode"
				? {
						...edit,
						sandboxMode: agentEditSchema.shape.sandboxMode.parse(
							nonEmptyString(value) ?? undefined,
						),
					}
				: {
						...edit,
						approvalsReviewer:
							agentEditSchema.shape.approvalsReviewer.parse(
								nonEmptyString(value) ?? undefined,
							),
					},
		);
	}
</script>

<section class="border-t border-input-border pt-4">
	<button
		type="button"
		aria-expanded={open}
		aria-controls={id}
		onclick={() => (open = !open)}
		class="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-focus"
		><ChevronRight
			size={14}
			aria-hidden="true"
			class={cn(
				"transition-transform duration-[220ms] ease-out motion-reduce:transition-none",
				open && "rotate-90",
			)}
		/>高度な設定</button
	>
	<div
		{id}
		inert={!open}
		aria-hidden={!open}
		class={cn(
			"grid transition-[grid-template-rows] duration-[220ms]",
			"ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
			open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
		)}
	>
		<div class="min-h-0 overflow-hidden">
			<div class="mt-4 grid gap-4">
				<div class="flex items-center gap-2 text-sm">
					<span>サンドボックスモード</span><SliderCard
						control={permissionControl(mode, [reviewer])}
						outlined
						{disabled}
						onChange={change}
					/>
				</div>
				<ApprovalPolicyField {edit} {onChange} />
			</div>
		</div>
	</div>
</section>
