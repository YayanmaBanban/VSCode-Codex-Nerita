// 認証専用Webviewの公開状態と、入力をHostへ渡す通信契約。
export type PiAuthItem = {
	id: string;
	name: string;
	configured: boolean;
	methods: { id: string; name: string }[];
};
/** 保存済みの秘密値は含めず、SDKが現在要求する入力だけを公開する。 */
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
/** Hostの状態通知を受け入れる前に描画に使う値を確認する。 */
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
		(state.active === null || typeof state.active === "string") &&
		typeof state.notice === "string" &&
		(state.error === null || typeof state.error === "string") &&
		(state.feedback === undefined ||
			(!!state.feedback &&
				typeof state.feedback === "object" &&
				!Array.isArray(state.feedback) &&
				Object.values(state.feedback).every(
					(item) =>
						!!item &&
						typeof item.notice === "string" &&
						(item.error === null || typeof item.error === "string"),
				))) &&
		(state.prompt === null ||
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
						)))))
	);
}
