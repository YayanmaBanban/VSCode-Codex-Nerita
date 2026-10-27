<!-- 自動レビューの承認方法・レビューモデル・追加方針を編集し、保存と適用を要求する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { untrack } from "svelte";
	import type { ManagerState } from "@nerita/shared/agentManager/messages";
	import {
		autoReviewConfigSchema,
		defaultAutoReview,
		type AutoReviewConfig,
	} from "@nerita/shared/agentManager/autoReview";
	import type { ManagerSave } from "./useAgentManager.svelte";
	import { registerDraftEditor } from "./managerDraftContext";
	import AgentManagerFooter from "./AgentManagerFooter.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";
	import Field from "./Field.svelte";
	import HelpButton from "../ui/HelpButton.svelte";
	import { inputStyle } from "./managerFields";

	let {
		state: hostState,
		busy,
		dirty,
		saved,
		save,
		onDirty,
		onDiscard,
	}: {
		state: ManagerState;
		busy: boolean;
		dirty: boolean;
		saved: boolean;
		save: ManagerSave;
		onDirty: () => void;
		onDiscard?: (() => void) | undefined;
	} = $props();
	let config = $state.raw<AutoReviewConfig>(
		untrack(() => hostState.autoReview ?? defaultAutoReview()),
	);
	const context = registerDraftEditor({
		canSave: () => valid && !busy,
		capture: () => ({
			version: 1,
			backend: "pi",
			base: {
				type: "autoReview",
				backend: "pi",
				config: hostState.autoReview ?? defaultAutoReview(),
			},
			change: { type: "autoReview", backend: "pi", config },
		}),
		submit: () =>
			document
				.querySelector<HTMLFormElement>("main form")
				?.requestSubmit(),
	});
	if (context?.restored?.change.type === "autoReview") {
		config = context.restored.change.config;
	}
	let model = $derived(
		hostState.models.pi.find((item) => item.value === config.model),
	);
	let efforts = $derived([
		"off",
		...(model?.efforts ?? []).filter((value) => value !== "off"),
	]);
	let modelValid = $derived(
		model !== undefined && efforts.includes(config.thinking),
	);
	let valid = $derived(
		autoReviewConfigSchema.safeParse(config).success &&
			(config.mode === "manual" || modelValid),
	);

	/** 編集中は実行設定を変えず、保存時にだけ Host へ反映する。 */
	function change(patch: Partial<AutoReviewConfig>) {
		config = { ...config, ...patch };
		onDirty();
	}
	/** モデルに対応しない推論レベルを引き継がず、候補内の値を選ぶ。 */
	function changeModel(value: string) {
		const selected = hostState.models.pi.find(
			(item) => item.value === value,
		);
		const thinking =
			selected?.efforts?.find((value) => value === "low") ?? "off";
		change({
			model: value,
			thinking: autoReviewConfigSchema.shape.thinking.parse(thinking),
		});
	}
	/** 入力と候補を両方検証し、設定だけを保存する。ここではモデルを呼ばない。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!valid || busy) {
			return;
		}
		save({
			type: "autoReview",
			backend: "pi",
			config: autoReviewConfigSchema.parse(config),
		});
	}
</script>

<form class="grid min-w-0 gap-5 pb-24" onsubmit={submit}>
	<header class="flex items-center gap-1">
		<h2 class="m-0 text-lg font-semibold">自動レビュー</h2>
		<HelpButton label="自動レビューのヘルプ" disabled={busy}>
			{#snippet content()}
				自動レビューでは一部の通常操作の審査を省略し、危険操作や確認が必要な操作を選択したモデルへ送ります。ガードレールの拒否や
				Sandbox の上限は変更しません。設定はこのワークスペースの VS Code
				保存領域で管理します。
			{/snippet}
		</HelpButton>
	</header>
	<fieldset disabled={busy} class="m-0 grid min-w-0 gap-5 border-0 p-0">
		<div class="grid min-w-0 gap-4 sm:grid-cols-2">
			<Field label="承認方法">
				<ConfigControl
					appearance="field"
					disabled={busy}
					option={{
						id: "auto-review-mode",
						name: "承認方法",
						currentValue: config.mode,
						options: [
							{ value: "manual", name: "手動承認" },
							{
								value: "auto",
								name: "自動レビュー",
								description: "トークンを消費します",
							},
						],
					}}
					onChange={(value: string) =>
						change({
							mode: autoReviewConfigSchema.shape.mode.parse(
								value,
							),
						})}
				/>
			</Field>
			<Field label="レビューモデル">
				<ConfigControl
					appearance="field"
					disabled={busy}
					option={{
						id: "auto-review-model",
						name: "レビューモデル",
						currentValue: config.model,
						options: [
							{ value: "", name: "モデルを選択" },
							...hostState.models.pi.map((item) => ({
								value: item.value,
								name: item.name,
							})),
						],
					}}
					onChange={changeModel}
				/>
			</Field>
			<Field label="推論レベル">
				<ConfigControl
					appearance="field"
					disabled={busy || model === undefined}
					option={{
						id: "auto-review-thinking",
						name: "推論レベル",
						currentValue:
							model === undefined ? "off" : config.thinking,
						options: efforts.map((value) => ({
							value,
							name: value === "off" ? "なし" : value,
						})),
					}}
					onChange={(value: string) =>
						change({
							thinking:
								autoReviewConfigSchema.shape.thinking.parse(
									value,
								),
						})}
				/>
			</Field>
			<Field label="審査の待ち時間">
				<ConfigControl
					appearance="field"
					disabled={busy}
					option={{
						id: "auto-review-timeout",
						name: "審査の待ち時間",
						currentValue: String(config.timeoutMs),
						options: [10000, 30000, 60000, 120000].map((value) => ({
							value: String(value),
							name: `${value / 1000}秒`,
						})),
					}}
					onChange={(value: string) =>
						change({ timeoutMs: Number(value) })}
				/>
			</Field>
		</div>
		{#if config.mode === "auto" && !valid}
			<p role="alert" class="m-0 text-sm text-warning">
				利用できるモデルと推論レベルを選択してください。
			</p>
		{/if}
		<label class="grid min-w-0 gap-2 text-sm">
			<span class="flex items-center gap-1"
				>追加の判断方針<HelpButton
					label="追加の判断方針のヘルプ"
					content="標準の保護方針を維持したまま、プロジェクトで注意する対象を追加できます。"
				/></span
			>
			<textarea
				aria-label="追加の判断方針"
				class={cn(inputStyle, "h-[96px] resize-none")}
				rows={4}
				maxlength={8000}
				value={config.instructions}
				oninput={(event) =>
					change({ instructions: event.currentTarget.value })}
			></textarea>
		</label>
		<div
			class="grid gap-2 rounded-lg border border-input-border p-4 text-sm text-muted"
		>
			<p class="m-0">
				審査にはユーザーの依頼と、関連する会話・操作・差分を送信します。登録済みの秘密値、推論本文、ツール引数内の環境変数の値は送信内容から除きます。
			</p>
			<p class="m-0">
				判定できない場合や時間切れでは、実行を保留して手動承認へ戻します。拒否された操作は実行しません。
			</p>
		</div>
	</fieldset>

	<AgentManagerFooter
		{onDiscard}
		discardDisabled={busy}
		{dirty}
		{saved}
		disabled={busy || !valid}
		label="保存して適用"
	/>
</form>
