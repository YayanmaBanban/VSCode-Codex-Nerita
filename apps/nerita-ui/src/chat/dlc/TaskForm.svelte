<!-- 手動タスクの編集内容を保持し、工程状態の変更は Host に委ねる。 -->
<script lang="ts">
	import type { DlcTask } from "@nerita/shared/dlc/contracts";

	let { onPlan }: { onPlan: (tasks: DlcTask[]) => void } = $props();
	let tasks = $state.raw<DlcTask[]>([]);
	let title = $state("");
	let instructions = $state("");
	let paths = $state("");
	let valid = $derived(
		title.trim() !== "" &&
			instructions.trim() !== "" &&
			paths.trim() !== "",
	);
	/** 手動タスクの入力を組み立て、対象パスの区切りと前後の空白を統一する。 */
	function task(): DlcTask {
		return {
			title,
			instructions,
			paths: paths
				.split(",")
				.map((value) => value.trim().replaceAll("\\", "/")),
		};
	}
	/** 入力中のタスクを計画へ追加し、次のタスク用に入力欄を空にする。 */
	function add() {
		tasks = [...tasks, task()];
		title = "";
		instructions = "";
		paths = "";
	}
	/** 有効な計画だけを親へ渡し、ブラウザーによるフォーム送信を抑止する。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (valid) {
			onPlan([...tasks, task()]);
		}
	}
</script>

<form class="dlc-form" onsubmit={submit}>
	<h3>手動タスクの登録</h3>
	{#if tasks.length > 0}<p>{tasks.length} 件を追加済み</p>{/if}
	<label>タスク名<input required maxlength={256} bind:value={title} /></label>
	<label
		>実装する内容<textarea
			required
			maxlength={16000}
			bind:value={instructions}></textarea></label
	>
	<label
		>対象ファイル（相対パス、カンマ区切り）<input
			required
			bind:value={paths}
		/></label
	>
	<div class="dlc-toolbar">
		<button
			type="button"
			disabled={!valid || tasks.length >= 49}
			onclick={add}>次のタスクを追加</button
		><button type="submit" disabled={!valid}>プランを登録</button>
	</div>
</form>
