// Host の入力 UI を注入する契約と、入力要求の共通検証を定義する。
import { AppServerRpcError } from "../protocol/rpcMessage";

/** 秘密入力や選択を Webview の永続状態に残さないための境界。 */
export type InteractionService = {
	input: (
		title: string,
		secret: boolean,
		signal: AbortSignal,
		validate?: (value: string) => string | undefined,
	) => Promise<string | undefined>;
	choose: (
		title: string,
		choices: string[],
		signal: AbortSignal,
	) => Promise<string | undefined>;
	open: (url: string) => Promise<void>;
};
/** 入力要求の必須文字列を検証する。 */
export function text(value: unknown): string {
	if (typeof value !== "string") {
		throw new AppServerRpcError(-32602, "Invalid request");
	}
	return value;
}
