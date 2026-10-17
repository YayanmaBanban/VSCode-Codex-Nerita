<!-- 承認ポリシーと granular の要求種類を、独立した設定値として編集する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import Check from "@lucide/svelte/icons/check";
	import { cn } from "cnfast";
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		agentEditSchema,
		granularApprovalSchema,
		type AgentEdit,
	} from "@nerita/shared/agentManager/config";
	import Field from "../agentManager/Field.svelte";
	import { managerOption } from "../agentManager/modelOptions";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";

	let {
		edit,
		onChange,
		disabled,
	}: {
		edit: AgentEdit;
		onChange: (edit: AgentEdit) => void;
		disabled: boolean;
	} = $props();
	const labels = {
		sandbox_approval: "サンドボックス外での実行",
		rules: "ルールによる承認要求",
		skill_approval: "スキルの承認",
		request_permissions: "追加権限の要求",
		mcp_elicitations: "MCP からの入力要求",
	};
	const descriptions: Record<string, string> = {
		"on-request": "サンドボックス外の実行操作で承認を求める",
		never: "承認なし",
		granular: "承認の種類ごとに決める",
	};
	let granular = $derived(
		typeof edit.approvalPolicy === "object"
			? edit.approvalPolicy.granular
			: undefined,
	);
	let retained = $state.raw(untrack(() => granular));
	let displayed = $derived(granular ?? retained);
	let open = $derived(!!granular);
	let policy = $derived.by(() => {
		if (granular) {
			return "granular";
		}
		if (typeof edit.approvalPolicy === "string") {
			return edit.approvalPolicy;
		}
		return "on-request";
	});
	let option = $derived(
		managerOption(
			"approval_policy",
			"承認ポリシー",
			policy,
			Object.entries(descriptions).map(([value, description]) => ({
				value,
				name: value,
				description,
			})),
			false,
		),
	);
	// 閉じるアニメーション中も最後の内容を維持し、閉じた入力は inert にする。

	/** 現在の詳細な承認設定を保持してポリシーを切り替え、選択値を検証して親へ返す。 */
	function changePolicy(value: string) {
		if (granular) {
			retained = granular;
		}
		onChange({
			...edit,
			approvalPolicy:
				value === "granular"
					? {
							granular: granularApprovalSchema.parse({
								sandbox_approval: true,
								rules: true,
								skill_approval: true,
								request_permissions: true,
								mcp_elicitations: true,
							}),
						}
					: agentEditSchema.shape.approvalPolicy.parse(
							nonEmptyString(value) ?? undefined,
						),
		});
	}
</script>

<div class="grid">
	<Field label="承認ポリシー"
		><ConfigControl
			{option}
			{disabled}
			appearance="field"
			onChange={changePolicy}
		/></Field
	>
	<div
		inert={!open}
		aria-hidden={!open}
		class={cn(
			"grid transition-[grid-template-rows] duration-[220ms]",
			"ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
			open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
		)}
	>
		<div class="min-h-0 overflow-hidden">
			<div class="pt-4">
				{#if displayed}<fieldset
						class="grid gap-3 rounded-md border border-input-border p-3"
					>
						<legend class="text-sm">承認要求を許可する項目</legend
						>{#each granularApprovalSchema.keyof().options as key (key)}<SettingsTooltip
								content={key}
								>{#snippet children({ props })}<label
										{...props}
										class="flex items-center gap-2 text-sm"
										><span
											class="relative inline-flex size-5 shrink-0"
											><input
												type="checkbox"
												checked={displayed[key]}
												onchange={(event) => {
													if (displayed) {
														onChange({
															...edit,
															approvalPolicy: {
																granular: {
																	...displayed,
																	[key]: event
																		.currentTarget
																		.checked,
																},
															},
														});
													}
												}}
												class="peer sr-only"
											/><span
												aria-hidden="true"
												class={cn(
													"size-5 rounded-full border border-solid border-input-border bg-transparent",
													"peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
													"peer-disabled:opacity-50",
												)}
											></span><span
												aria-hidden="true"
												class={cn(
													"pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-emerald-700",
													"text-white opacity-0 transition-opacity duration-160 ease-out",
													"peer-checked:opacity-100",
													"motion-reduce:transition-none",
												)}
												><Check
													size={14}
													strokeWidth={3}
												/></span
											></span
										>{labels[key]}</label
									>{/snippet}</SettingsTooltip
							>{/each}
					</fieldset>{/if}
			</div>
		</div>
	</div>
</div>
