<!-- 依頼原文と明示的な設定をそのまま Host の検証境界へ渡す。 -->
<script lang="ts">
	import {
		ExecutionProfileSchema,
		DlcProjectTypeSchema,
		type ExecutionProfile,
		type DlcProjectType,
	} from "@nerita/shared/dlc/contracts";
	import type { UiMessage } from "@nerita/shared/messages";

	let {
		send,
		onSubmitted,
		pending,
	}: {
		send: (message: UiMessage) => void;
		onSubmitted: (requestId: string) => void;
		pending: boolean;
	} = $props();
	let title = $state("");
	let request = $state("");
	let profile = $state<ExecutionProfile>("classic");
	let projectType = $state<DlcProjectType | "detected">("detected");
	/** 依頼作成の要求番号を先に通知し、入力中の本文と明示的な設定を Host へ送る。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (pending) {
			return;
		}
		const requestId = crypto.randomUUID();
		onSubmitted(requestId);
		send({
			type: "dlc/create",
			requestId,
			title,
			request,
			profile,
			...(projectType === "detected" ? {} : { projectType }),
		});
	}
</script>

<form class="dlc-form" onsubmit={submit}>
	<label
		>Intent のタイトル<input
			required
			maxlength={256}
			bind:value={title}
		/></label
	>
	<label
		>開発したい内容<textarea required maxlength={16000} bind:value={request}
		></textarea></label
	>
	<details>
		<summary>詳細設定</summary>
		<label
			>実行プロファイル<select
				aria-label="実行プロファイル"
				value={profile}
				onchange={(event) =>
					(profile = ExecutionProfileSchema.parse(
						event.currentTarget.value,
					))}
				>{#each ExecutionProfileSchema.options as value (value)}<option
						>{value}</option
					>{/each}</select
			></label
		>
		<label
			>開発上の扱い<select
				aria-label="開発上の扱い"
				value={projectType}
				onchange={(event) =>
					(projectType =
						event.currentTarget.value === "detected"
							? "detected"
							: DlcProjectTypeSchema.parse(
									event.currentTarget.value,
								))}
			>
				<option value="detected">検出結果に従う</option><option
					value="greenfield">新規開発</option
				><option value="brownfield">既存コードを変更</option><option
					value="unknown">判断を保留</option
				>
			</select></label
		>
	</details>
	<button
		type="submit"
		disabled={pending || title.trim() === "" || request.trim() === ""}
	>
		{pending ? "作成中…" : "Intent を作成"}
	</button>
</form>
