<!-- バックエンドに応じて管理画面を選び、選択と未保存入力の破棄を確認する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { mergeProps } from "bits-ui";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import RotateCw from "@lucide/svelte/icons/rotate-cw";
	import UserPlus from "@lucide/svelte/icons/user-plus";
	import { cn } from "cnfast";
	import type {
		ManagerBridge,
		ManagerState,
	} from "@nerita/shared/agentManager/messages";
	import {
		useAgentManager,
		type ManagerSave,
	} from "./useAgentManager.svelte";
	import HandoffSettings from "./HandoffSettings.svelte";
	import CodexAgentManager from "../codex/CodexAgentManager.svelte";
	import PiAgentManager from "../pi/PiAgentManager.svelte";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";
	import ActionNotice from "../ui/ActionNotice.svelte";
	import { buttonStyle } from "./managerFields";
	import "../chat/chat.css";
	let { bridge }: { bridge: ManagerBridge } = $props();
	let tab = $state<"agents" | "handoff">("agents");
	let selected = $state("");
	let dirty = $state(false);
	let pending = $state<(() => void) | null>(null);
	let savedSelection: string | undefined;
	const editor = useAgentManager(
		untrack(() => bridge),
		(state) => {
			dirty = false;
			selected = loadedSelection(state, savedSelection ?? selected);
			savedSelection = undefined;
		},
	);
	const BackendManager = $derived(
		editor.state?.activeBackend === "pi"
			? PiAgentManager
			: CodexAgentManager,
	);
	const headerAction = cn(
		"inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent p-0",
		"focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
	function navigate(action: () => void) {
		if (dirty) {
			pending = action;
		} else {
			action();
		}
	}
	function discard() {
		dirty = false;
		pending?.();
		pending = null;
	}
	const save: ManagerSave = (change) => {
		if (change.type === "createAgent") {
			savedSelection =
				change.backend === "codex"
					? `.codex/agents/${change.filename}.toml`
					: `pi:${change.edit.definition?.name}`;
		} else if (change.type === "agent") {
			const definition = change.edit.definition;
			const renamed =
				change.agentId.startsWith("pi:") && definition !== undefined;
			if (renamed) {
				savedSelection = `pi:${definition.name}`;
			}
		}
		editor.save(change);
	};
	/** 保存済みの項目を選び、見つからなければ使用バックエンドの先頭へ移動する。 */
	function loadedSelection(state: ManagerState, current: string) {
		const matches =
			current === "new" ||
			(current === "defaults" && state.activeBackend === "pi");
		if (matches) {
			return current;
		}
		const agents = state.agents.filter(
			(agent) => agent.backend === state.activeBackend,
		);
		return (
			agents.find((agent) => agent.id === current)?.id ??
			agents[0]?.id ??
			"defaults"
		);
	}
</script>

<main class="mx-auto grid w-full max-w-5xl gap-6 p-4 text-foreground sm:p-6">
	<header class="grid gap-3 border-b border-input-border pb-4">
		<h1 class="m-0 text-xl font-semibold">Agent Manager</h1>
		<p class="m-0 text-sm break-words text-muted">
			{editor.state?.label ?? "設定を読み込み中…"}
		</p>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<nav aria-label="管理対象" class="flex gap-2">
				{#each [["agents", "Agents"], ["handoff", "ハンドオフ"]] as [id, label] (id)}<button
						class={buttonStyle}
						aria-pressed={tab === id}
						disabled={editor.busy}
						onclick={() => {
							if (id !== tab) {
								navigate(
									() =>
										(tab =
											id === "agents"
												? "agents"
												: "handoff"),
								);
							}
						}}>{label}</button
					>{/each}
			</nav>
			<div class="flex items-center gap-2">
				<SettingsTooltip content="再読み込み"
					>{#snippet children({ props })}<button
							{...mergeProps(
								{ ...props },
								{
									onclick: () =>
										navigate(() => editor.reload()),
								},
							)}
							class={headerAction}
							aria-label="再読み込み"
							disabled={editor.busy}
							><RotateCw size={16} aria-hidden="true" /></button
						>{/snippet}</SettingsTooltip
				>{#if tab === "agents"}<SettingsTooltip
						content="新しいエージェントを追加"
						>{#snippet children({ props })}<button
								{...mergeProps(
									{ ...props },
									{
										onclick: () =>
											navigate(() => (selected = "new")),
									},
								)}
								class={headerAction}
								aria-label="新しいエージェントを追加"
								disabled={editor.busy ||
									!editor.state ||
									selected === "new"}
								><UserPlus
									size={16}
									aria-hidden="true"
								/></button
							>{/snippet}</SettingsTooltip
					>{/if}
			</div>
		</div>
	</header>
	{#if pending}<ActionNotice
			label="未保存の変更"
			title="未保存の変更"
			description="未保存の変更を破棄して移動しますか？"
			actions={[
				{
					id: "continue",
					name: "編集を続ける",
					onClick: () => (pending = null),
				},
				{ id: "discard", name: "変更を破棄", onClick: discard },
			]}
		/>{/if}
	{#if isNonEmptyString(editor.error)}<p
			role="alert"
			class="m-0 text-sm break-words"
		>
			{editor.error}
		</p>{/if}{#if editor.notice !== ""}<p role="status" class="m-0 text-sm">
			{editor.notice}
		</p>{/if}
	{#if editor.state}{#each editor.state.errors as error, index (index)}<p
				role="alert"
				class="m-0 text-sm break-words"
			>
				{error}
			</p>{/each}{#key `${editor.state.activeBackend}:${editor.revision}`}{#if tab === "handoff"}<HandoffSettings
					state={editor.state}
					busy={editor.busy}
					{save}
					onDirty={() => (dirty = true)}
				/>{:else}<BackendManager
					state={editor.state}
					busy={editor.busy}
					{save}
					{selected}
					onSelect={(id: string) => {
						if (id !== selected) {
							navigate(() => (selected = id));
						}
					}}
					onDirty={() => (dirty = true)}
				/>{/if}{/key}{/if}
</main>
