<!-- サーバー由来の HTML を使わず、同梱アイコンを表示キーで解決する。 -->
<script lang="ts">
	import type { SubAgentSummary } from "@nerita/shared/subAgents";
	import { icons } from "./agentIconSources";

	let { iconKey }: { iconKey: SubAgentSummary["iconKey"] } = $props();
</script>

<img
	aria-hidden="true"
	alt=""
	class="block size-8 shrink-0 overflow-hidden rounded-[6px]"
	src={icons[iconKey]}
/>
