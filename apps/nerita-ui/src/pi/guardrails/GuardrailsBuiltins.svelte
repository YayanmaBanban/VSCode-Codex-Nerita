<!-- 組み込みの保護カテゴリを一覧にし、拒否・承認の変更を文書へ反映する。 -->
<script lang="ts">
	import {
		builtinPathDefinitions,
		builtinCommandDefinitions,
		type BuiltinRules,
	} from "@nerita/shared/guardrails/builtins";
	import GuardrailsBuiltinSwitch from "./GuardrailsBuiltinSwitch.svelte";

	let {
		value,
		disabled,
		onChange,
	}: {
		value: BuiltinRules;
		disabled: boolean;
		onChange: (value: BuiltinRules) => void;
	} = $props();
</script>

<div class="flex flex-col gap-5">
	<p class="m-0 text-muted">
		追加ルールの「許可」で組み込み保護を解除することはできません。変更は「保存して適用」で反映します。
	</p>
	<section aria-label="機密ファイルの保護">
		<h3 class="mt-0 mb-2 text-base font-semibold">機密ファイル</h3>
		{#each builtinPathDefinitions as definition (definition.id)}
			<GuardrailsBuiltinSwitch
				name={definition.name}
				description={definition.description}
				action={value.paths[definition.id]}
				{disabled}
				onChange={(action: "deny" | "ask") =>
					onChange({
						...value,
						paths: { ...value.paths, [definition.id]: action },
					})}
			/>
		{/each}
	</section>
	<section aria-label="危険コマンドの保護">
		<h3 class="mt-0 mb-2 text-base font-semibold">危険コマンド</h3>
		<p class="m-0 text-muted">
			既知の文字列パターンを検出します。引用文やスクリプト内部の意味までは解析しません。シェル実行の毎回承認は維持します。
		</p>
		{#each builtinCommandDefinitions as definition (definition.id)}
			<GuardrailsBuiltinSwitch
				name={definition.name}
				description={definition.description}
				action={value.commands[definition.id]}
				{disabled}
				onChange={(action: "deny" | "ask") =>
					onChange({
						...value,
						commands: {
							...value.commands,
							[definition.id]: action,
						},
					})}
			/>
		{/each}
	</section>
	<p class="m-0 text-muted">
		ワークスペース外への書き込みと、ガードレール設定自体・DLC
		管理ファイルへの書き込みは常に拒否します。
	</p>
</div>
