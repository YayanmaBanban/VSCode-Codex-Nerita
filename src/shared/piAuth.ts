// 認証専用 Webview の公開状態と、入力を Host へ渡す通信契約。
export type PiAuthItem = {
	id: string;
	name: string;
	configured: boolean;
	methods: { id: string; name: string }[];
};
/** 保存済みの秘密値は含めず、SDK が現在要求する入力だけを公開する。 */
export type PiAuthPrompt = {
	id: string;
	message: string;
	secret: boolean;
	options?: { id: string; label: string }[];
};
export type PiAuthState = {
	items: PiAuthItem[];
	active: string | null;
	prompt: PiAuthPrompt | null;
	notice: string;
	error: string | null;
	feedback?: Record<string, { notice: string; error: string | null }>;
};
export type PiAuthRequest =
	| { type: "ready" }
	| { type: "start"; id: string }
	| { type: "answer"; id: string; value: string }
	| { type: "cancel" };
/** 専用パネルからの要求も未知の型・過大な入力を拒否する。 */
export function isPiAuthRequest(value: unknown): value is PiAuthRequest {
	if (!value || typeof value !== "object") {
		return false;
	}
	const item = value as Record<string, unknown>;
	if (item.type === "ready" || item.type === "cancel") {
		return true;
	}
	return (
		typeof item.id === "string" &&
		item.id.length <= 4096 &&
		(item.type === "start" ||
			(item.type === "answer" &&
				typeof item.value === "string" &&
				item.value.length <= 65536))
	);
}
/** Host の状態通知を受け入れる前に、描画用の値を確認する。 */
export function isPiAuthState(value: unknown): value is PiAuthState {
	if (!value || typeof value !== "object") {
		return false;
	}
	const state = value as PiAuthState;
	return (
		Array.isArray(state.items) &&
		state.items.every(
			(item) =>
				!!item &&
				typeof item.id === "string" &&
				typeof item.name === "string" &&
				typeof item.configured === "boolean" &&
				Array.isArray(item.methods) &&
				item.methods.every(
					(method) =>
						!!method &&
						typeof method.id === "string" &&
						typeof method.name === "string",
				),
		) &&
		isNullableString(state.active) &&
		typeof state.notice === "string" &&
		(state.error === null || typeof state.error === "string") &&
		validAuthFeedback(state) &&
		validAuthPrompt(state)
	);
}

/** 未指定を表す `null` または文字列を受け付ける。 */
function isNullableString(value: unknown): boolean {
	return value === null || typeof value === "string";
}

/** 入力要求と選択肢の構造を検証する。 */
function validAuthPrompt(state: PiAuthState): boolean {
	return (
		state.prompt === null ||
		(!!state.prompt &&
			typeof state.prompt.id === "string" &&
			typeof state.prompt.message === "string" &&
			typeof state.prompt.secret === "boolean" &&
			(state.prompt.options === undefined ||
				(Array.isArray(state.prompt.options) &&
					state.prompt.options.every(
						(option) =>
							!!option &&
							typeof option.id === "string" &&
							typeof option.label === "string",
					))))
	);
}

/** 認証結果の通知とエラーを検証する。 */
function validAuthFeedback(state: PiAuthState) {
	return (
		state.feedback === undefined ||
		(!!state.feedback &&
			typeof state.feedback === "object" &&
			!Array.isArray(state.feedback) &&
			Object.values(state.feedback).every(
				(item) =>
					!!item &&
					typeof item.notice === "string" &&
					(item.error === null || typeof item.error === "string"),
			))
	);
}
