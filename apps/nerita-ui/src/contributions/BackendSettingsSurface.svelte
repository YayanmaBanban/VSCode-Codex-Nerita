<!-- バックエンドに対応する設定領域を選び、同じ宣言型 slot で項目を表示する。 -->
<script lang="ts">
	import type { ContributionSlotProps } from "./contributionProps";
	import ContributionSlot from "./ContributionSlot.svelte";

	let props: ContributionSlotProps = $props();
</script>

<div class="contents" data-settings-surface={props.contributions.surface}>
	<ContributionSlot name="settings.main" {...props} />
	<ContributionSlot name="settings.advanced" {...props} />
</div>
