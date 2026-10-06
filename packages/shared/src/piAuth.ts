// 認証専用 Webview の公開状態と、入力を Host へ渡す通信契約。
import { isRecord } from "./validation";

export type PiAuthItem = {
	id: string;
	name: string;
	configured: boolean;
	accounts?: {
		id: string;
		name: string;
		mode: "session" | "secret-storage";
		active: boolean;
	}[];
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
	if (value === null || typeof value !== "object") {
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
	if (!isRecord(value)) {
		return false;
	}
	return (
		Array.isArray(value.items) &&
		value.items.every(isAuthItem) &&
		isNullableString(value.active) &&
		typeof value.notice === "string" &&
		isNullableString(value.error) &&
		validAuthFeedback(value.feedback) &&
		validAuthPrompt(value.prompt)
	);
}

/** 未検証のプロバイダー項目と、アカウント・認証方式の配列を検証する。 */
function isAuthItem(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		typeof value.configured === "boolean" &&
		(value.accounts === undefined ||
			(Array.isArray(value.accounts) &&
				value.accounts.every(isAuthAccount))) &&
		Array.isArray(value.methods) &&
		value.methods.every(
			(method: unknown) =>
				isRecord(method) &&
				typeof method.id === "string" &&
				typeof method.name === "string",
		)
	);
}

/** アカウントの保存方式は公開契約の2種類に限定する。 */
function isAuthAccount(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		(value.mode === "session" || value.mode === "secret-storage") &&
		typeof value.active === "boolean"
	);
}

/** 未指定を表す `null` または文字列を受け付ける。 */
function isNullableString(value: unknown): boolean {
	return value === null || typeof value === "string";
}

/** 入力要求と選択肢の構造を検証する。 */
function validAuthPrompt(prompt: unknown): boolean {
	return (
		prompt === null ||
		(isRecord(prompt) &&
			typeof prompt.id === "string" &&
			typeof prompt.message === "string" &&
			typeof prompt.secret === "boolean" &&
			(prompt.options === undefined ||
				(Array.isArray(prompt.options) &&
					prompt.options.every(
						(option: unknown) =>
							isRecord(option) &&
							typeof option.id === "string" &&
							typeof option.label === "string",
					))))
	);
}

/** 認証結果の通知とエラーを検証する。 */
function validAuthFeedback(feedback: unknown) {
	return (
		feedback === undefined ||
		(isRecord(feedback) &&
			Object.values(feedback).every(
				(item: unknown) =>
					isRecord(item) &&
					typeof item.notice === "string" &&
					(item.error === null || typeof item.error === "string"),
			))
	);
}
