<!-- 入力中と送信済みの参照でアイコン・名前・行範囲を揃える。 -->
<script lang="ts">
	import type { ComposerTarget } from "@nerita/shared/composerTargets";
	import { referenceIcon } from "./composer/referencePresentation";

	let { path }: { path: ComposerTarget } = $props();
	const Icon = $derived(referenceIcon(path));
	const label = $derived(referenceLabel());
	/** セッションの参照形式を名前に添え、原文とハンドオフを区別する。 */
	function referenceLabel() {
		if (path.kind !== "session") {
			return path.name;
		}
		const prefix = path.mode === "handoff" ? "Handoff" : "Session";
		return `${prefix}: ${path.name}`;
	}
</script>

<Icon size={14} aria-hidden="true" />
<span class="truncate"
	>{label}{path.kind === "file" && path.range
		? `(${path.range.start.line}:${path.range.end.line})`
		: ""}</span
>
