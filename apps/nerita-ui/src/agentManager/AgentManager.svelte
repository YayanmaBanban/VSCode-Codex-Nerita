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
	import Tooltip from "../ui/Tooltip.svelte";
	import { provideSettingsPopupGroup } from "../ui/settingsPopup.svelte";
	import "../chat/chat.css";
	import ConfirmationDialog from "../ui/ConfirmationDialog.svelte";
	import ButtonCurtain from "../ui/ButtonCurtain.svelte";
	import { buttonStyle } from "./managerFields";
	import {
		provideDraftContext,
		type DraftEditor,
	} from "./managerDraftContext";
	import {
		currentDraftChange,
		restoreManagerDraft,
	} from "./restoreManagerDraft";
	import type { ManagerDraft } from "@nerita/shared/agentManager/draft";
	import { errorText } from "@nerita/shared/errorText";

	provideSettingsPopupGroup();

	let { bridge }: { bridge: ManagerBridge } = $props();
	let tab = $state<"agents" | "handoff">("agents");
	let selected = $state("");
	let dirty = $state(false);
	const advancedSettings = $state({ open: false });
	let pending = $state<(() => void) | null>(null);
	let pendingLabel = $state("");
	let draftEditor = $state.raw<DraftEditor>();
	let restored = $state.raw<ManagerDraft | null>(null);
	let restoreCandidate = $state.raw<ManagerDraft | null>(null);
	let restoreChoices = $state<Record<string, "current" | "draft">>({});
	let restoreRevision = $state(0);
	let recoveryOpen = $state(false);
	let draftBusy = $state(false);
	let draftError = $state<string | null>(null);
	let unreadableDraft = $state<string | null>(null);
	let handledDraft = "";
	let saving = false;
	let saveNavigation = false;
	provideDraftContext({
		get restored() {
			return restored;
		},
		register(value) {
			draftEditor = value;
			return () => {
				if (draftEditor === value) {
					draftEditor = undefined;
				}
			};
		},
	});
	// 保存でエディターが再生成されても、完了表示は保存した対象だけに出す。
	let savedTarget = $state<string>();
	let savedSelection: string | undefined;
	const editor = useAgentManager(
		untrack(() => bridge),
		loadState,
	);
	/** 保存後の移動と、読み込んだ下書きの復元を更新内容に合わせて行う。 */
	function loadState(state: ManagerState) {
		const destination = saving && saveNavigation ? pending : null;
		dirty = false;
		pending = null;
		selected = loadedSelection(state, savedSelection ?? selected);
		savedSelection = undefined;
		const wasSaving = saving;
		if (saving) {
			clearSavedDraft();
		}
		saving = false;
		saveNavigation = false;
		destination?.();
		if (!wasSaving) {
			inspectStoredDraft(state);
		}
	}
	/** 設定に保存した下書きを破棄し、失敗した場合は画面にエラーを残す。 */
	function clearSavedDraft() {
		const draft = restored;
		restored = null;
		if (draft !== null) {
			void editor.writeDraft(null).catch((error: unknown) => {
				draftError = errorText(error);
			});
		}
	}
	/** 同じ下書きを候補更新のたびに再適用しない。 */
	function inspectStoredDraft(state: ManagerState) {
		if (isNonEmptyString(state.draftError)) {
			unreadableDraft = state.draftError;
			return;
		}
		if (state.draft && JSON.stringify(state.draft) !== handledDraft) {
			handledDraft = JSON.stringify(state.draft);
			const result = restoreManagerDraft(state, state.draft);
			if (result.conflicts.length > 0 || result.missing) {
				restoreCandidate = state.draft;
				restoreChoices = {};
			} else {
				applyRestored(state.draft);
			}
		}
	}

	const restoreResult = $derived(
		editor.state && restoreCandidate
			? restoreManagerDraft(
					editor.state,
					restoreCandidate,
					restoreChoices,
				)
			: null,
	);
	const unresolved = $derived(
		restoreResult?.conflicts.some(
			(conflict) => restoreChoices[conflict.path] === undefined,
		) === true,
	);
	const restoreAvailable = $derived(
		restoreResult !== null && !restoreResult.missing,
	);
	const restoreDisabled = $derived(
		draftBusy || !restoreAvailable || unresolved,
	);

	provideManagerFeedback({
		get errors() {
			const errors = isNonEmptyString(editor.error)
				? [editor.error]
				: (editor.state?.errors ?? []);
			return isNonEmptyString(draftError)
				? [...errors, draftError]
				: errors;
		},
		get busy() {
			return editor.busy;
		},
		get reloadRequired() {
			return editor.reloadRequired;
		},
		reload,
	});
	let locked = $derived(editor.busy || editor.reloadRequired || draftBusy);
	const navigationSaveDisabled = $derived(
		locked || draftEditor?.canSave() !== true,
	);
	const BackendManager = $derived(
		editor.state?.activeBackend === "pi"
			? PiAgentManager
			: CodexAgentManager,
	);
	const tabStyle = cn(
		"manager-tab relative rounded-t-md border-0 bg-transparent px-4 py-2 text-sm font-medium text-primary-text",
		"transition-colors duration-200 ease-out motion-reduce:transition-none",
		"enabled:hover:bg-settings-hover",
		"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
	const headerAction = cn(
		"inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent p-0",
		"focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
		"disabled:cursor-not-allowed disabled:opacity-50",
	);
	const primaryDialogAction = cn(
		buttonStyle,
		"bg-primary enabled:hover:bg-primary",
	);
	const secondaryDialogAction = cn(
		buttonStyle,
		"group relative isolate overflow-hidden",
	);
	/** 未保存の変更がある場合は画面移動を保留し、変更がなければその場で移動する。 */
	function navigate(action: () => void, destination = "選択した画面") {
		if (locked) {
			return;
		}
		if (dirty) {
			pending = action;
			pendingLabel = destination;
		} else {
			savedTarget = undefined;
			action();
		}
	}
	/** 未保存の変更があれば退避するかを確認し、変更がなければ再読み込みする。 */
	function reload() {
		if (dirty) {
			draftError = null;
			recoveryOpen = true;
			return;
		}
		saving = false;
		handledDraft = "";
		editor.reload();
	}
	/** 未保存の変更を破棄し、保留していた操作で画面を切り替える。 */
	async function discard() {
		if (locked) {
			return;
		}
		draftBusy = true;
		try {
			if (restored !== null) {
				await editor.writeDraft(null);
			}
			dirty = false;
			restored = null;
			savedTarget = undefined;
			pending?.();
			pending = null;
		} catch (error) {
			draftError = errorText(error);
		} finally {
			draftBusy = false;
		}
	}
	/** 保存と破棄以外にも、保留中の移動を取り消して編集を継続できるようにする。 */
	function cancelNavigation() {
		pending = null;
		saveNavigation = false;
	}
	/** 入力の検証を通常のフォームに任せ、保存成功時だけ保留していた移動先へ進む。 */
	function saveAndNavigate() {
		saveNavigation = true;
		draftEditor?.submit();
	}
	/** 退避に失敗した場合は再読み込みせず、元の編集内容を保持する。 */
	async function reloadWithDraft(keep: boolean) {
		if (draftBusy) {
			return;
		}
		draftBusy = true;
		draftError = null;
		try {
			if (keep) {
				if (!draftEditor) {
					throw new Error("退避する編集内容を取得できません。");
				}
				await editor.writeDraft(draftEditor.capture());
				handledDraft = "";
			} else if (restored !== null) {
				await editor.writeDraft(null);
			}
			restored = null;
			saving = false;
			saveNavigation = false;
			recoveryOpen = false;
			editor.reload();
		} catch (error) {
			draftError = errorText(error);
		} finally {
			draftBusy = false;
		}
	}
	/** 競合の選択結果を編集欄へ戻し、設定ファイルへの適用には通常の保存を要求する。 */
	function applyRestored(draft: ManagerDraft) {
		if (!editor.state) {
			return;
		}
		const result = restoreManagerDraft(editor.state, draft, restoreChoices);
		if (result.missing) {
			return;
		}
		restored = {
			...draft,
			base: currentDraftChange(editor.state, draft.change),
			change: result.change,
		};
		tab = draft.change.type === "handoff" ? "handoff" : "agents";
		if (draft.change.type === "agent") {
			selected = draft.change.agentId;
		} else if (draft.change.type === "createAgent") {
			selected = "new";
		} else if (draft.change.type === "defaults") {
			selected = "defaults";
		}
		dirty = true;
		restoreCandidate = null;
		restoreRevision += 1;
	}
	/** 保存済みの下書きを破棄し、成功してから確認ダイアログを閉じる。 */
	async function discardStoredDraft() {
		draftBusy = true;
		try {
			await editor.writeDraft(null);
			restoreCandidate = null;
			unreadableDraft = null;
			draftError = null;
		} catch (error) {
			draftError = errorText(error);
		} finally {
			draftBusy = false;
		}
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
		saving = true;
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
	/** 競合の項目名をフォームで使っている日本語に揃える。 */
	function conflictLabel(path: string) {
		const labels: Record<string, string> = {
			name: "名前",
			description: "説明",
			prompt: "システムプロンプト",
			model: "モデル",
			thinking: "推論",
			reasoningEffort: "推論",
			disabled: "無効化",
			defaultModel: "既定のモデル",
			defaultThinking: "既定の推論",
			maxThinking: "推論レベルの上限",
			maxSubagentSpawnsPerSession: "セッション内の起動上限",
			timeoutMs: "タイムアウト",
			strategy: "モデル選択のモード",
			pi: "Pi の設定",
			codex: "Codex の設定",
		};
		return labels[path.split(".").at(-1) ?? ""] ?? "設定";
	}
	/** 未指定と文字列を読みやすく表示し、比較する値を省略しない。 */
	function conflictValue(value: unknown) {
		if (value === undefined) {
			return "未指定";
		}
		if (typeof value === "string") {
			return value === "" ? "空欄" : value;
		}
		return JSON.stringify(value, null, 2);
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
				{#each [["agents", "Agents"], ["handoff", "ハンドオフ"]] as [id, label] (id)}
					<button
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
									label,
								);
							}
						}}>{label}</button
					>
				{/each}
			</nav>
			<div class="flex items-center gap-2">
				<Tooltip content="再読み込み">
					{#snippet children({ props })}
						<button
							{...mergeProps(
								{ ...props },
								{
									onclick: reload,
								},
							)}
							class={headerAction}
							aria-label="再読み込み"
							disabled={editor.busy}
						>
							<RotateCw size={16} aria-hidden="true" /></button
						>
					{/snippet}
				</Tooltip>
				{#if tab === "agents"}
					<Tooltip content="新しいエージェントを追加">
						{#snippet children({ props })}
							<button
								{...mergeProps(
									{ ...props },
									{
										onclick: () =>
											navigate(
												() => (selected = "new"),
												"新しいエージェント",
											),
									},
								)}
								class={headerAction}
								aria-label="新しいエージェントを追加"
								disabled={locked ||
									!editor.state ||
									selected === "new"}
							>
								<UserPlus size={16} aria-hidden="true" />
							</button>
						{/snippet}
					</Tooltip>
				{/if}
			</div>
		</div>
	</header>
	{#if formProps}
		{#key `${formProps.state.activeBackend}:${editor.revision}:${restoreRevision}`}
			{#if tab === "handoff"}
				<HandoffSettings {...formProps} />
			{:else}
				<BackendManager
					{...formProps}
					{advancedSettings}
					{selected}
					onSelect={(id: string) => {
						if (id !== selected) {
							navigate(
								() => (selected = id),
								editor.state?.agents.find(
									(agent) => agent.id === id,
								)?.name ?? "Workspace defaults",
							);
						}
					}}
				/>
			{/if}
		{/key}
	{:else}
		<AgentManagerFooter
			dirty={false}
			saved={false}
			disabled
			showSave={false}
		/>
	{/if}
</main>

<ConfirmationDialog
	open={pending !== null}
	busy={editor.busy || draftBusy}
	title="変更を保存して移動しますか？"
	description={`保存が完了すると「${pendingLabel}」へ移動します。`}
	onCancel={cancelNavigation}
>
	{#if editor.error}
		<p role="alert" class="text-sm text-warning">{editor.error}</p>
	{/if}
	{#if draftError}
		<p role="alert" class="text-sm text-warning">{draftError}</p>
	{/if}
	<div class="flex flex-wrap justify-end gap-2">
		<button
			type="button"
			class={primaryDialogAction}
			disabled={navigationSaveDisabled}
			onclick={saveAndNavigate}>保存して移動</button
		>
		<button
			type="button"
			class={secondaryDialogAction}
			disabled={locked}
			onclick={discard}
			>破棄して移動
			{#if !locked}<ButtonCurtain
					name="破棄して移動"
					className="bg-red-300"
				/>{/if}</button
		>
		<button
			type="button"
			class={secondaryDialogAction}
			disabled={editor.busy}
			onclick={cancelNavigation}
			>編集を続ける
			{#if !editor.busy}<ButtonCurtain
					name="編集を続ける"
					className="bg-green-300"
				/>{/if}</button
		>
	</div>
	{#if editor.reloadRequired}
		<button
			type="button"
			class={secondaryDialogAction}
			onclick={() => {
				pending = null;
				reload();
			}}
			>再読み込みして復旧<ButtonCurtain
				name="再読み込みして復旧"
				className="bg-green-300"
			/></button
		>
	{/if}
</ConfirmationDialog>
<ConfirmationDialog
	open={recoveryOpen}
	busy={draftBusy}
	title="再読み込み前に下書きを保存しますか？"
	description="下書きには元の値と編集後の値を保存します。再読み込み後、最新の設定と比較して復元します。"
	onCancel={() => {
		recoveryOpen = false;
	}}
>
	<p class="text-xs break-all text-muted">
		保存先: .nerita/agent-manager-draft-{editor.state?.activeBackend}.json
	</p>
	{#if draftError}
		<p role="alert" class="text-sm text-warning">{draftError}</p>
	{/if}
	<div class="flex flex-wrap justify-end gap-2">
		<button
			type="button"
			class={primaryDialogAction}
			disabled={draftBusy}
			onclick={() => reloadWithDraft(true)}>下書きを保存</button
		>
		<button
			type="button"
			class={secondaryDialogAction}
			disabled={draftBusy}
			onclick={() => reloadWithDraft(false)}
			>破棄
			{#if !draftBusy}<ButtonCurtain
					name="破棄"
					className="bg-red-300"
				/>{/if}</button
		>
		<button
			type="button"
			class={secondaryDialogAction}
			disabled={draftBusy}
			onclick={() => {
				recoveryOpen = false;
			}}
			>編集を続ける
			{#if !draftBusy}<ButtonCurtain
					name="編集を続ける"
					className="bg-green-300"
				/>{/if}</button
		>
	</div>
</ConfirmationDialog>
<ConfirmationDialog
	open={restoreCandidate !== null}
	busy={draftBusy}
	title="下書きと最新の設定が競合しています"
	description="同じ項目に別の変更があります。復元する値を選んでください。競合していない変更は両方とも保持します。"
	onCancel={() => {
		restoreCandidate = null;
	}}
>
	{#if restoreResult?.missing}
		<p class="text-sm">
			編集対象のエージェントが削除されています。下書きはファイルに保持されています。
		</p>
	{:else}
		{#if restoreResult}
			<div class="grid gap-4">
				{#each restoreResult.conflicts as conflict (conflict.path)}
					<fieldset
						class="grid min-w-0 gap-2 rounded border border-input-border p-3 text-xs"
					>
						<legend class="break-all"
							>{conflictLabel(conflict.path)}</legend
						>
						{#each ["current", "draft"] as source (source)}
							<label
								class={cn(
									"grid min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded border border-input-border",
									"has-[:checked]:border-focus has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
								)}
							>
								<span
									class="flex items-center justify-center border-r border-input-border px-3"
								>
									<input
										type="radio"
										name={conflict.path}
										checked={restoreChoices[
											conflict.path
										] === source}
										onchange={() => {
											restoreChoices[conflict.path] =
												source === "draft"
													? "draft"
													: "current";
										}}
									/>
								</span>
								<span
									class="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]"
									><span
										class="border-b border-input-border px-3 py-2 font-medium"
										>{source === "draft"
											? "下書き"
											: "最新の設定"}</span
									>
									<pre
										class="m-0 max-h-40 min-w-0 overflow-auto px-3 py-2 break-words whitespace-pre-wrap">{conflictValue(
											source === "draft"
												? conflict.draft
												: conflict.current,
										)}</pre></span
								>
							</label>
						{/each}
					</fieldset>
				{/each}
			</div>
		{/if}
	{/if}
	{#if draftError}
		<p role="alert" class="text-sm text-warning">{draftError}</p>
	{/if}
	<div class="mt-4 flex flex-wrap justify-end gap-2">
		<button
			type="button"
			class={primaryDialogAction}
			disabled={restoreDisabled}
			onclick={() => {
				if (restoreCandidate) {
					applyRestored(restoreCandidate);
				}
			}}>選択した値を復元</button
		>
		<button
			type="button"
			class={secondaryDialogAction}
			disabled={draftBusy}
			onclick={discardStoredDraft}
			>下書きを破棄
			{#if !draftBusy}<ButtonCurtain
					name="下書きを破棄"
					className="bg-red-300"
				/>{/if}</button
		>
		<button
			type="button"
			class={secondaryDialogAction}
			disabled={draftBusy}
			onclick={() => {
				restoreCandidate = null;
			}}
			>後で復元する
			{#if !draftBusy}<ButtonCurtain
					name="後で復元する"
					className="bg-yellow-300"
				/>{/if}</button
		>
	</div>
</ConfirmationDialog>
<ConfirmationDialog
	open={unreadableDraft !== null}
	busy={draftBusy}
	title="下書きを読み込めません"
	description="設定の編集は続けられます。保存済みの下書きを確認するか、不要であれば破棄してください。"
	onCancel={() => {
		unreadableDraft = null;
	}}
>
	<p class="text-xs break-words text-warning">{unreadableDraft}</p>
	{#if draftError}
		<p role="alert" class="text-xs text-warning">{draftError}</p>
	{/if}
	<div class="flex flex-wrap justify-end gap-2">
		<button
			type="button"
			class={primaryDialogAction}
			disabled={draftBusy}
			onclick={discardStoredDraft}>下書きを破棄</button
		>
		<button
			type="button"
			class={secondaryDialogAction}
			disabled={draftBusy}
			onclick={() => {
				unreadableDraft = null;
			}}
			>後で確認する
			{#if !draftBusy}<ButtonCurtain
					name="後で確認する"
					className="bg-yellow-300"
				/>{/if}</button
		>
	</div>
</ConfirmationDialog>

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
