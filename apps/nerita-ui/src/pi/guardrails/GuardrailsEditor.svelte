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
	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const setTab = (value: "form" | "json") => {
		tab = value;
	};

	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
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
			/><GuardrailsProbePane {...{ editor, probe, setProbe }} />
		</div>
	</main>
{:else}<p class="p-5">ガードレール設定を読み込み中…</p>{/if}
