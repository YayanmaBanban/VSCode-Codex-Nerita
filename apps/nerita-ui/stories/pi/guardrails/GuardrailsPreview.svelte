<script lang="ts">
	// 既存の固定応答を各プレビューで独立して保持する。
	import { SvelteSet } from "svelte/reactivity";
	import GuardrailsEditor from "../../../src/pi/guardrails/GuardrailsEditor.svelte";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import { defaultGuardrails } from "@nerita/shared/guardrails/config";
	import type {
		GuardBridge,
		GuardRequest,
		GuardReply,
		GuardState,
	} from "@nerita/shared/guardrails/messages";

	let {
		invalid = false,
		failure,
		loading = false,
		pathRuleCount = 1,
		selectedDirectory = "src/private",
		initialStatus = "applied",
		warnings = [],
		pendingType,
		privacyEnabled = true,
		onRequest,
	}: {
		invalid?: boolean;
		failure?: "save" | "check" | "edit" | "discard";
		loading?: boolean;
		pathRuleCount?: number;
		selectedDirectory?: string | null;
		initialStatus?: "applied" | "dirty" | "unapplied" | "unavailable";
		warnings?: string[];
		pendingType?: "save" | "check" | "discard";
		privacyEnabled?: boolean;
		onRequest?: (message: GuardRequest) => void;
	} = $props();

	/** プレビューごとに初期文書を独立して作る。 */
	function initialGuardState(): GuardState {
		const config = defaultGuardrails();
		config.privacy.enabled = privacyEnabled;
		// ユーザー追加ルールの表示例。既定の機密保護は組み込み側で管理する。
		config.pathRules = Array.from(
			{ length: pathRuleCount },
			(_, index) => ({
				id: index === 0 ? "env-files" : `path-${index}`,
				reason: "秘密値を含む可能性があるファイルです。",
				action: "deny",
				match: "glob",
				pattern: ".env*",
				directory: ".",
				exceptions: [".env.example", ".env.sample"],
				operations: ["read", "write"],
			}),
		);
		const activeText = JSON.stringify(config, null, 2);
		if (initialStatus === "unapplied") {
			config.pathAccess.outsideRead = "ask";
		}
		const text = invalid
			? "{ invalid JSON"
			: JSON.stringify(config, null, 2);
		return {
			type: "state",
			text,
			version: 1,
			dirty: initialStatus === "dirty",
			root: "workspace/project",
			activeText: initialStatus === "unavailable" ? "" : activeText,
		};
	}
	/** 指定された外部応答と編集バッファだけから、表示用の次の状態を作る。 */
	function validateRequest(
		message: GuardRequest,
		inspectionError: string | null,
	) {
		const type = message.type;
		const target = message.type === "check" ? message.probe.input : "";
		// 原因の異なる Host の失敗例を分け、入力内容が不正とは限らないことも示す。
		const failures = {
			save: "guardrails.json が読み取り専用のため保存できません。\nファイルの読み取り専用を解除してから、もう一度「保存して適用」を実行してください。",
			edit: "別の編集によりファイルが更新されたため、入力を反映できません。\n「編集を破棄して再読込」で最新の設定を読み込み、変更をやり直してください。",
			check: `対象パス / コマンド「${target}」を検査できません。検査に必要なファイル情報の読み取り権限がありません。\n対象フォルダのアクセス権を確認してから、もう一度「検査」を実行してください。`,
			discard:
				"guardrails.json が読み取り専用のため、適用中の設定を保存できません。\nファイルの読み取り専用を解除してから、もう一度「適用中の設定に戻す」を実行してください。",
		};
		if (failure !== undefined && type === failure) {
			throw new Error(failures[failure]);
		}
		if (type === "check" && isNonEmptyString(inspectionError)) {
			throw new Error(inspectionError);
		}
	}
	/** 外部境界の応答だけを代替し、判定や保存時の検証はここで再実装しない。 */
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
			warnings:
				message.type === "check" || message.type === "save"
					? warnings
					: [],
		};
		try {
			validateRequest(message, inspectionError);
			if (message.type === "edit") {
				state = {
					...state,
					text: message.text,
					version: state.version + 1,
					dirty: true,
				};
			} else if (message.type === "select-directory") {
				reply.directory = selectedDirectory;
			} else if (message.type === "discard") {
				state = {
					...state,
					text: state.activeText,
					version: state.version + 1,
					dirty: false,
				};
			} else {
				if (message.type === "save") {
					state = { ...state, dirty: false, activeText: state.text };
					reply.notice =
						"保存して適用しました。以前に承認した操作は、新しい設定でもう一度承認する必要があります。";
				} else {
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
		const response = {
			inspectionError: null as string | null,
			release: undefined as (() => void) | undefined,
		};

		let state = initialGuardState();
		const listeners = new SvelteSet<(message: GuardReply) => void>();
		const post = (message: GuardReply) =>
			listeners.forEach((listener) => listener(message));
		/** 応答を任意のタイミングで返し、要求後のユーザー入力との競合を検証する。 */
		const deliver = (message: Exclude<GuardRequest, { type: "ready" }>) => {
			const result = respond(state, message, response.inspectionError);
			state = result.state;
			post(state);
			post(result.reply);
		};

		return {
			response,
			subscribe(listener: Parameters<GuardBridge["subscribe"]>[0]) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			postMessage(message: Parameters<GuardBridge["postMessage"]>[0]) {
				onRequest?.(message);
				if (message.type === pendingType) {
					response.release = () => deliver(message);
					return;
				}
				if (message.type === "ready") {
					if (!loading) {
						post(state);
					}
					return;
				}
				deliver(message);
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
