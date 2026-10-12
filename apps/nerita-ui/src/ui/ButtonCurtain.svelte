<script lang="ts">
	// ホバーとキーボードフォーカスでボタンを覆うカーテンを共有する。
	import { cn } from "cnfast";
	/** 親ボタンに group・relative・overflow-hidden を指定し、色を渡す。 */
	type Props = { name: string; className: string };
	let { name, className }: Props = $props();
</script>

<span
	aria-hidden="true"
	class={cn(
		"pointer-events-none absolute inset-0 flex items-center justify-center",
		"text-black [clip-path:polygon(0_0,0_0,0_0)]",
		"transition-[clip-path] duration-300 ease-out motion-reduce:transition-none",
		"group-hover:[clip-path:polygon(0_0,200%_0,0_200%)]",
		"group-focus-visible:[clip-path:polygon(0_0,200%_0,0_200%)]",
		className,
	)}>{name}</span
>
