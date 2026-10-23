<!-- 一覧にない保存済みモデルも、利用者が変更するまで候補として保持する。 -->
<script lang="ts">
	import type { ManagerModel } from "@nerita/shared/agentManager/messages";

	let { value, models }: { value: string; models: ManagerModel[] } = $props();
</script>

{#if value !== "" && !models.some((model) => model.value === value)}
	<option {value}>{value}（保存済み・未確認）</option>
{/if}
{#each models as model (model.value)}
	<option value={model.value}>{model.name}</option>
{/each}
