<script lang="ts">
	// 既存の固定応答を各プレビューで独立して保持する。
	import { SvelteSet } from "svelte/reactivity";
	import GuardrailsEditor from "../../../src/pi/guardrails/GuardrailsEditor.svelte";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { defaultGuardrails } from "@nerita/shared/guardrails/config";
	import type {
		GuardBridge,
		GuardReply,
		GuardState,
	} from "@nerita/shared/guardrails/messages";

	let {
		invalid = false,
		failure,
		loading = false,
	}: {
		invalid?: boolean;
		failure?: "save" | "check" | "edit";
		loading?: boolean;
	} = $props();

	/** プレビューごとに初期文書を独立して作る。 */
	function initialGuardState(): GuardState {
		const text = invalid
			? "{ invalid JSON"
			: JSON.stringify(defaultGuardrails(), null, 2);
		return {
			type: "state",
			text,
			version: 1,
			dirty: false,
			root: "workspace/project",
			activeText: text,
		};
	}
	/** 指定された外部応答と編集バッファだけから、表示用の次の状態を作る。 */
	function respond(
		state: GuardState,
		message: Exclude<
			Parameters<GuardBridge["postMessage"]>[0],
			{ type: "ready" }
		>,
		inspectionError: string | null,
	) {
		const reply: Extract<GuardReply, { type: "reply" }> = {
			type: "reply",
			id: message.id,
			error: null,
			notice: "",
			result: null,
			warnings: [],
		};
		try {
			if (message.type === failure) {
				throw new Error(
					"設定を反映できませんでした。下書きを確認して再試行してください。",
				);
			}
			const error = inspectionError;
			if (message.type === "check" && isNonEmptyString(error)) {
				throw new Error(error);
			}
			if (message.type === "edit") {
				state = {
					...state,
					text: message.text,
					version: state.version + 1,
					dirty: true,
				};
			} else {
				if (message.type === "save") {
					state = { ...state, dirty: false };
					reply.notice =
						"保存しました。実行に反映するには適用してください。";
				} else if (message.type === "apply") {
					state = { ...state, activeText: state.text };
					reply.notice = "適用しました。変更前の承認は失効しました。";
				} else {
					reply.notice =
						"設定と入力例を検査しました。操作は実行していません。";
					reply.result = {
						action: "deny",
						reasons: ["秘密値を含む可能性があるファイルです。"],
						rules: ["env-files"],
						paths: ["workspace/project/.env"],
						uncertainties: [],
					};
				}
			}
		} catch (error) {
			reply.error =
				error instanceof Error ? error.message : "検査に失敗しました。";
		}
		return { state, reply };
	}
	/** 編集バッファを保持し、保存・適用・検査の固定応答を返す。永続化や判定は行わない。 */
	function mockBridge() {
		// 検査結果は外部応答の例であり、入力から判定を再実装しない。
		const response = { inspectionError: null as string | null };

		let state = initialGuardState();
		const listeners = new SvelteSet<(message: GuardReply) => void>();
		const post = (message: GuardReply) =>
			listeners.forEach((listener) => listener(message));

		return {
			response,
			subscribe(listener: Parameters<GuardBridge["subscribe"]>[0]) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			postMessage(message: Parameters<GuardBridge["postMessage"]>[0]) {
				if (message.type === "ready") {
					if (!loading) {
						post(state);
					}
					return;
				}
				const result = respond(
					state,
					message,
					response.inspectionError,
				);
				state = result.state;
				post(state);
				post(result.reply);
			},
		};
	}
	const bridge = mockBridge();
	function attachResponse(element: HTMLDivElement) {
		Object.assign(element, { response: bridge.response });
	}
</script>

<div style="display:contents" data-story-guardrails {@attach attachResponse}>
	<GuardrailsEditor {bridge} />
</div>
