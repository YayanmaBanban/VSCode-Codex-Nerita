<!-- ガードレールのフォーム・JSON 編集と判定シミュレーションを組み立て、文書の保存状態を共有する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { type GuardProbe } from "@nerita/shared/guardrails/messages";

	import "../../chat/chat.css";
	import { guardrailsFormSchema } from "./formSchema";
	import "./guardrails.css";

	import { useGuardrails } from "./useGuardrails.svelte";

	let { bridge }: GuardrailsEditorProps = $props();
	const editor = useGuardrails(untrack(() => bridge));
	let tab = $state<"form" | "json">("form");
	let probe = $state.raw<GuardProbe>({
		tool: "read",
		input: ".env",
		cwd: ".",
	});

	let parsed = $derived.by(() => {
		try {
			return guardrailsFormSchema.safeParse(JSON.parse(editor.text));
		} catch {
			return undefined;
		}
	});
	let status = $derived(
		editor.state ? documentStatus(editor.text, editor.state) : "",
	);

	import {
		type GuardrailsEditorProps,
		documentStatus,
	} from "./GuardrailsEditorParts";
	import GuardrailsEditorHeader from "./GuardrailsEditorHeader.svelte";
	import GuardrailsProbePane from "./GuardrailsProbePane.svelte";

	import GuardrailsRulePane from "./GuardrailsRulePane.svelte";
	/** ルール編集の表示をフォームと JSON の間で切り替える。 */
	const setTab = (value: "form" | "json") => {
		tab = value;
	};

	/** 判定シミュレーションに使うツール・作業ディレクトリ・入力を保持する。 */
	const setProbe = (value: GuardProbe) => {
		probe = value;
	};
</script>

{#if editor.state}
	<main
		class="guardrails-editor text-foreground"
		data-document-status={status}
	>
		<GuardrailsEditorHeader
			{...{
				editor,
				state: editor.state,
				status,
				probe,
			}}
		/>
		<div class="guardrails-panes">
			<GuardrailsRulePane
				{...{
					tab,
					setTab,
					editor,
					parsed,
				}}
			/>
			<GuardrailsProbePane {...{ editor, probe, setProbe }} />
		</div>
	</main>
{:else}
	<p class="p-5">ガードレール設定を読み込み中…</p>
{/if}
