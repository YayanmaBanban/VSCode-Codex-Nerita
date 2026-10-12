<!-- 思考中の文言と筆記する猫を表示し、OS の動きを減らす設定に従う。 -->
<script lang="ts">
	import { prefersReducedMotion } from "svelte/motion";
	import ShinyText from "../ui/ShinyText.svelte";
	import RunStatusIcon from "./RunStatusIcon.svelte";
</script>

<div
	class="my-2 flex items-center gap-1 text-[12px] text-muted"
	role="status"
	aria-label="思考中..."
>
	<ShinyText
		text="思考中..."
		disabled={prefersReducedMotion.current}
		color="var(--nerita-description-foreground)"
		shineColor="var(--nerita-foreground)"
	/>
	<RunStatusIcon kind="writing" />
</div>
