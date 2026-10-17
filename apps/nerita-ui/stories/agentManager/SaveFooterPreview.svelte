<!-- 実フッターへ編集・保存応答を渡し、一時表示を繰り返し確認するための操作を用意する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import SaveFooter from "../../src/agentManager/SaveFooter.svelte";

	let {
		initial = "hidden",
		disabled = false,
	}: { initial?: "hidden" | "dirty" | "saved"; disabled?: boolean } =
		$props();
	let dirty = $state(untrack(() => initial === "dirty"));
	let saved = $state(untrack(() => initial === "saved"));
	let generation = $state(0);
	/** 保存応答の到着を再現し、終了した演出も確認用操作で再生できるようにする。 */
	function receiveSave() {
		dirty = false;
		saved = true;
		generation++;
	}
</script>

<form
	class="grid gap-4 p-5 pb-24"
	onsubmit={(event) => {
		event.preventDefault();
		receiveSave();
	}}
>
	<p>
		入力で未保存を表示し、保存成功の通知後2秒で退場します。退場中の操作で表示へ戻ります。
	</p>
	<label
		>フッター確認用の入力<input
			class="ml-2 border border-input-border bg-input"
			oninput={() => (dirty = true)}
		/></label
	>
	<button type="button" onclick={receiveSave}>保存成功を通知（再生）</button>
	{#key generation}<SaveFooter {dirty} {saved} {disabled} />{/key}
</form>
