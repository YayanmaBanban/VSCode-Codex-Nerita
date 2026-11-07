<!-- 個人情報自体は保持せず、文書の保存・適用に合わせて送信前検査を設定する。 -->
<script lang="ts">
	import type { PrivacyConfig } from "@nerita/shared/guardrails/privacy";
	import HelpButton from "../../ui/HelpButton.svelte";

	let {
		config,
		locked,
		onChange,
	}: {
		config: PrivacyConfig;
		locked: boolean;
		onChange: (config: PrivacyConfig) => void;
	} = $props();
</script>

<section
	class="flex min-w-0 flex-col gap-4 p-4"
	aria-label="個人情報の送信設定"
>
	<header class="flex items-center gap-1">
		<h2 class="m-0 text-[14px]">個人情報の送信</h2>
		<HelpButton
			label="個人情報の送信のヘルプ"
			content="Pi Web・HTTP MCP からの個人情報送信を検出し、事前に確認します。送信先不明の検索はブロックします。Curl・PowerShell は未対応です。"
		/>
	</header>
	<fieldset
		class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
		disabled={locked}
	>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				checked={config.enabled}
				onchange={(event) =>
					onChange({
						...config,
						enabled: event.currentTarget.checked,
					})}
			/>
			送信前の個人情報検査
		</label>
		<p class="m-0 text-muted">
			メールアドレス・電話番号・カード番号と、項目名を伴うマイナンバー・免許証番号・旅券番号・口座番号・社員番号などを検査します。
		</p>
		<label class="flex items-center gap-2">
			<input type="checkbox" checked={false} disabled />
			PII 検出モデルの利用
		</label>
		<p class="m-0 text-muted">
			オフ（準備中）。モデルによる氏名・住所などの追加検査は、現在利用できません。
		</p>
	</fieldset>
</section>
