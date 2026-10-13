<!-- バックエンドの保存済み設定を同じキーボード対応サブメニューで選ぶ。 -->
<script lang="ts">
	import Cpu from "@lucide/svelte/icons/cpu";
	import type { BackendId } from "@nerita/shared/backend";
	import SelectionSubmenu from "./SelectionSubmenu.svelte";

	let {
		backend,
		onSelect,
	}: {
		backend: BackendId | undefined;
		onSelect: (value: BackendId) => void;
	} = $props();
</script>

<SelectionSubmenu
	label="バックエンド"
	value={backend}
	options={[
		["codex", "Codex"],
		["pi", "Pi"],
	]}
	{onSelect}
	disabled={backend === undefined}
	>{#snippet icon()}<Cpu
			size={16}
			aria-hidden="true"
		/>{/snippet}</SelectionSubmenu
>
