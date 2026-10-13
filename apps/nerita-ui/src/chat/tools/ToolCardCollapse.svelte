<!-- 閉じる遷移の完了後に本文と購読を解放し、開き直しは終了待ちを無効化する。 -->
<script lang="ts">
	import { tick, type Snippet } from "svelte";
	let {
		open,
		id,
		className,
		children,
	}: { open: boolean; id: string; className: string; children: Snippet } =
		$props();
	let element = $state<HTMLDivElement>();
	let present = $state(false);
	/** アニメーションの完了を待つ Promise を返し、取り消しによる拒否は呼び出し側で処理する。 */
	function animationFinished(animation: Animation) {
		return animation.finished;
	}

	// 閉じる操作後も DOM の遷移完了まで本文を保持し、開き直した場合は旧完了処理を失効させる。
	$effect(() => {
		let current = true;
		if (open) {
			present = true;
		} else if (present && element) {
			const target = element;
			// CSS の状態反映を待ち、取り消された遷移も終了として扱う。
			void tick()
				.then(() =>
					Promise.allSettled(
						target.getAnimations().map(animationFinished),
					),
				)
				.then(() => {
					if (current) {
						present = false;
					}
				});
		}
		return () => {
			current = false;
		};
	});
</script>

<div
	bind:this={element}
	{id}
	class={className}
	inert={!open}
	aria-hidden={!open}
>
	<div class="min-h-0 overflow-hidden">
		{#if open || present}{@render children()}{/if}
	</div>
</div>
