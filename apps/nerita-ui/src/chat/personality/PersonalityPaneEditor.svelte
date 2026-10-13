<!-- 性格設定のプリセットを選択・編集し、設定ファイルで固定された指示を保護して保存を要求する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import type {
		PersonalityMessage,
		PersonalityScope,
	} from "@nerita/shared/personality";
	import ConfigControl from "../composer/ConfigControl.svelte";
	import InstructionEditor from "./InstructionEditor.svelte";

	let {
		scope,
		settings,
		pending,
		send,
		title,
	}: {
		scope: "global" | "workspace";
		settings: PersonalityScope;
		pending: boolean;
		send: (message: PersonalityMessage) => void;
		title: string;
	} = $props();
	const selected = untrack(() =>
		settings.presets.find((preset) => preset.name === settings.selected),
	);
	const initialText = untrack(
		() => settings.configuredText ?? selected?.text ?? "",
	);
	let name = $state(selected?.name ?? "");
	let text = $state(initialText);
	let locked = $derived(settings.configuredText !== null);
	let inputDisabled = $derived(locked || pending);
	let changedName = $derived(name.trim() !== selected?.name);
	let collision = $derived(
		changedName &&
			settings.presets.some((preset) => preset.name === name.trim()),
	);
	let saveDisabled = $derived(
		savePresetDisabled(
			locked,
			pending,
			name,
			collision,
			text,
			changedName,
			initialText,
		),
	);
	/** 現在の適用範囲を付けて、性格設定のプリセット選択を Host へ要求する。 */
	function select(name: string) {
		send({
			type: "personality/select",
			scope,
			name,
			requestId: crypto.randomUUID(),
		});
	}
	/** プリセット名を整えて保存を要求し、更新前の名前を付けて新規作成と名前変更を区別する。 */
	function save() {
		send({
			type: "personality/save",
			scope,
			name: name.trim(),
			text,
			originalName: selected?.name ?? "",
			requestId: crypto.randomUUID(),
		});
	}
	/** プリセットの保存可否を編集内容とロック状態から判定する。 */
	function savePresetDisabled(
		locked: boolean,
		pending: boolean,
		name: string,
		collision: boolean,
		text: string,
		changedName: boolean,
		initialText: string,
	): boolean | undefined {
		const unavailableName = locked || pending || name.trim() === "";
		if (unavailableName || collision || text.length > 100000) {
			return true;
		}
		return !changedName && text === initialText;
	}
</script>

<div class="flex min-w-0 flex-col gap-[10px] pt-[8px]">
	<ConfigControl
		inDialog
		option={{
			id: scope,
			name: `${title}のプリセット`,
			currentValue: settings.selected,
			options: [
				{ name: "なし", value: "" },
				...settings.presets.map((preset) => ({
					name: preset.name,
					value: preset.name,
				})),
			],
		}}
		disabled={inputDisabled}
		onChange={select}
	/>
	<label class="flex flex-col gap-[5px] text-[12px]"
		>プリセット名<input
			aria-label={`${title}のプリセット名`}
			bind:value={name}
			maxlength={200}
			disabled={inputDisabled}
			class="min-w-0 rounded-[4px] border border-solid border-input-border bg-input px-[8px] py-[7px] text-input-text"
		/></label
	>
	{#if locked}<p class="m-0 text-[11px] text-muted">
			config.toml の <code>developer_instructions</code> を使用しています（変更不可）。
		</p>{/if}
	<InstructionEditor
		text={initialText}
		label={`${title}の指示`}
		disabled={inputDisabled}
		onChange={(value: string) => {
			text = value;
		}}
	/>
	{#if collision}<p role="alert" class="m-0 text-[11px]">
			同名のプリセットが存在します。
		</p>{/if}
	{#if text.length > 100000}<p role="alert">
			指示は100,000文字以内にしてください。
		</p>{/if}
	<div class="flex justify-end">
		<button type="button" disabled={saveDisabled} onclick={save}
			>{changedName ? "保存" : "更新"}</button
		>
	</div>
</div>
