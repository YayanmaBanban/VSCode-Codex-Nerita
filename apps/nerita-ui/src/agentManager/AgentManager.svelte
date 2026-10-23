<!-- バックエンドに応じて管理画面を選び、選択と未保存入力の破棄を確認する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { mergeProps } from "bits-ui";
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
	import AgentManagerFooter from "./AgentManagerFooter.svelte";
	import { provideManagerFeedback } from "./agentManagerFeedback";
	import CodexAgentManager from "../codex/CodexAgentManager.svelte";
	import PiAgentManager from "../pi/PiAgentManager.svelte";
	import SettingsTooltip from "../chat/SettingsTooltip.svelte";
	import { provideSettingsPopupGroup } from "../ui/settingsPopup.svelte";
	import "../chat/chat.css";

	provideSettingsPopupGroup();

	let { bridge }: { bridge: ManagerBridge } = $props();
	let tab = $state<"agents" | "handoff">("agents");
	let selected = $state("");
	let dirty = $state(false);
	const advancedSettings = $state({ open: false });
	let pending = $state<(() => void) | null>(null);
	// 保存でエディターが再生成されても、完了表示は保存した対象だけに出す。
	let savedTarget = $state<string>();
	let savedSelection: string | undefined;
	const editor = useAgentManager(
		untrack(() => bridge),
		(state) => {
			dirty = false;
			pending = null;
			selected = loadedSelection(state, savedSelection ?? selected);
			savedSelection = undefined;
		},
	);
	provideManagerFeedback({
		get errors() {
			return isNonEmptyString(editor.error)
				? [editor.error]
				: (editor.state?.errors ?? []);
		},
		get busy() {
			return editor.busy;
		},
		get reloadRequired() {
			return editor.reloadRequired;
		},
		reload,
	});
	let locked = $derived(editor.busy || editor.reloadRequired);
	const BackendManager = $derived(
		editor.state?.activeBackend === "pi"
			? PiAgentManager
			: CodexAgentManager,
	);
	const tabStyle = cn(
		"manager-tab relative rounded-t-md border-0 bg-transparent px-4 py-2 text-sm font-medium text-muted",
		"transition-colors duration-200 ease-out motion-reduce:transition-none",
		"enabled:hover:bg-settings-hover enabled:hover:text-foreground aria-pressed:text-foreground",
		"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
	const headerAction = cn(
		"inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent p-0",
		"focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
	/** 未保存の変更がある場合は画面移動を保留し、変更がなければその場で移動する。 */
	function navigate(action: () => void) {
		if (locked) {
			return;
		}
		if (dirty) {
			pending = action;
		} else {
			savedTarget = undefined;
			action();
		}
	}
	/** 再読み込みを要求するエラーからは直接復旧し、通常の再読み込みでは未保存の変更を確認する。 */
	function reload() {
		if (editor.reloadRequired) {
			editor.reload();
			return;
		}
		navigate(() => editor.reload());
	}
	/** 未保存の変更を破棄し、保留していた操作で画面を切り替える。 */
	function discard() {
		if (locked) {
			return;
		}
		dirty = false;
		savedTarget = undefined;
		pending?.();
		pending = null;
	}
	/** 修正可能な保存失敗の表示を外し、現在の入力に対する検証へ切り替える。 */
	function markDirty() {
		editor.clearError();
		dirty = true;
	}
	/** 保存後に選び直すエージェントを記録し、保存要求を共通の管理処理へ渡す。 */
	const save: ManagerSave = (change) => {
		if (locked) {
			return;
		}
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
		savedTarget = targetFor(change);
		editor.save(change);
	};
	const formProps = $derived.by(() => {
		if (!editor.state) {
			return undefined;
		}
		return {
			state: editor.state,
			busy: locked,
			dirty,
			saved:
				editor.saved &&
				savedTarget === (tab === "handoff" ? "handoff" : selected),
			save,
			onDirty: markDirty,
			onDiscard: pending ? discard : undefined,
		};
	});
	/** 保存完了を表示する対象を、保存要求と名前変更後の選択先から決める。 */
	function targetFor(change: Parameters<ManagerSave>[0]) {
		if (change.type === "createAgent") {
			return savedSelection;
		}
		if (change.type === "agent") {
			return savedSelection ?? change.agentId;
		}
		return change.type === "handoff" ? "handoff" : "defaults";
	}
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
		<h1 class="m-0 text-xl font-semibold">
			{#if editor.state}Agent Manager - {editor.state.activeBackend ===
				"pi"
					? "Pi"
					: "Codex"}{:else}Agent Manager{/if}
		</h1>

		<div class="flex flex-wrap items-center justify-between gap-3">
			<nav aria-label="管理対象" class="flex gap-1">
				{#each [["agents", "Agents"], ["handoff", "ハンドオフ"]] as [id, label] (id)}<button
						class={tabStyle}
						aria-pressed={tab === id}
						disabled={locked}
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
									onclick: reload,
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
								disabled={locked ||
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
	{#if formProps}{#key `${formProps.state.activeBackend}:${editor.revision}`}{#if tab === "handoff"}<HandoffSettings
					{...formProps}
				/>{:else}<BackendManager
					{...formProps}
					{advancedSettings}
					{selected}
					onSelect={(id: string) => {
						if (id !== selected) {
							navigate(() => (selected = id));
						}
					}}
				/>{/if}{/key}{:else}<AgentManagerFooter
			dirty={false}
			saved={false}
			disabled
			showSave={false}
		/>{/if}
</main>

<style>
	.manager-tab::after {
		position: absolute;
		inset: auto 1rem 0;
		height: 2px;
		border-radius: 999px;
		background: currentColor;
		content: "";
		opacity: 0;
		transform: scaleX(0.5);
		transition:
			transform 200ms ease-out,
			opacity 200ms ease-out;
	}

	.manager-tab[aria-pressed="true"]::after {
		background: var(--nerita-text-link-foreground);
		opacity: 1;
		transform: scaleX(1);
	}

	.manager-tab:enabled:hover::after,
	.manager-tab:focus-visible::after {
		opacity: 1;
		transform: scaleX(1);
	}

	@media (prefers-reduced-motion: reduce) {
		.manager-tab::after {
			transition: none;
		}
	}
</style>
