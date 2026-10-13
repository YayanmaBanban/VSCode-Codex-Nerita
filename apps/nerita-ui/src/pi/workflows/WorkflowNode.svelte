<!-- ノード内の識別子と会話の継承状態を読みやすい短い表記で表示する。 -->
<script lang="ts">
	import {
		Handle,
		Position,
		type NodeProps,
		type Node,
	} from "@xyflow/svelte";
	/** ワークフローの描画ノード。表示用の情報だけを持ち、工程の実行状態は変更しない。 */
	type StepNode = Node<
		{ id: string; agent: string; context: string; output: boolean },
		"step"
	>;
	let { data }: NodeProps<StepNode> = $props();
</script>

<Handle type="target" position={Position.Left} />
<div class="text-left">
	<div class="font-semibold">{data.id}</div>
	<div class="mt-1 opacity-75">{data.agent}</div>
	<div class="mt-2 text-xs opacity-65">
		{data.context}{data.output ? " · 出力" : ""}
	</div>
</div>
<Handle type="source" position={Position.Right} />
