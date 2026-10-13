<!-- 狭いパネルでは選択ノードを読める倍率で中央へ表示する。 -->
<script lang="ts">
	import { useNodesInitialized, useSvelteFlow } from "@xyflow/svelte";

	let { selected }: { selected: string } = $props();
	const { fitView } = useSvelteFlow();
	const initialized = useNodesInitialized();
	// ノードの初期計測と選択の変化を待ち、狭い画面の Flow の表示位置を更新する。
	$effect(() => {
		const id = selected;
		const focusNarrow =
			initialized.current &&
			window.matchMedia("(max-width: 720px)").matches;
		if (!focusNarrow) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			void fitView({ nodes: [{ id }], minZoom: 1, maxZoom: 1 });
		});
		return () => cancelAnimationFrame(frame);
	});
</script>
