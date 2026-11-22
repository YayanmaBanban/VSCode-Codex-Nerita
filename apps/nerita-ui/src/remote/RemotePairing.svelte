<!-- 接続が確立するまで、PC で発行したコードを受け付ける。 -->
<script lang="ts">
	import { cn } from "cnfast";

	let {
		offline,
		pending,
		feedback,
		submitCode,
	}: {
		offline: boolean;
		pending: boolean;
		feedback: string;
		submitCode: (code: string) => Promise<void>;
	} = $props();
	let code = $state("");

	/** ブラウザーの制約検証を通過したコードを送る。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		void submitCode(code);
	}
</script>

<main
	class={cn(
		"mx-auto mt-[clamp(2rem,10vh,6rem)] mb-4 max-w-md p-[clamp(1rem,5vw,1.75rem)]",
		"rounded-2xl border border-solid border-panel-border bg-input",
	)}
>
	<form class="grid gap-2.5" onsubmit={submit} aria-labelledby="pair-heading">
		<h2 id="pair-heading" class="m-0 text-lg">リモートアクセス</h2>
		<p class="mx-0 mt-0 mb-2 text-muted">
			PC の Nerita
			でリモートアクセスをオンにして、表示されたコードを入力してください。
		</p>
		<label for="code" class="text-sm font-semibold">
			8桁のペアリングコード
		</label>
		<input
			id="code"
			class={cn(
				"min-h-[44px] w-full min-w-0 rounded-[0.6rem] p-2.5",
				"border border-solid border-input-border bg-input text-input-text",
				"tracking-[0.16em] tabular-nums",
			)}
			bind:value={code}
			type="text"
			inputmode="numeric"
			autocomplete="one-time-code"
			pattern={"[0-9]{8}"}
			maxlength="8"
			required
		/>
		<button
			type="submit"
			class="rounded-[0.6rem] border-0 bg-primary px-3 py-2 text-primary-text"
			disabled={pending || offline}
		>
			{pending ? "接続中…" : "接続する"}
		</button>
	</form>
	<p role="status" class="mx-0 mt-2.5 mb-0">
		{offline ? "端末がオフラインです。" : feedback}
	</p>
</main>
