// サーバーからの質問・MCPフォームを、取消可能なHostの入力UIへ接続する。
import { isRecord } from "../../../shared/validation";
import {
	AppServerRpcError,
	type AppServerRequest,
} from "../protocol/rpcMessage";

import type { InteractionService } from "./interactionService";
import { userInput } from "./userInput";
import { elicitation } from "./elicitation";

/** クライアントが提供していない動的ツールや認証更新要求を実行しない。 */
export async function interactionRequest(
	request: AppServerRequest,
	ui: InteractionService,
	signal: AbortSignal,
): Promise<unknown> {
	if (!isRecord(request.params)) {
		throw new AppServerRpcError(-32602, "Invalid request");
	}
	if (request.method === "item/tool/requestUserInput") {
		return userInput(request.params, ui, signal);
	}
	if (request.method === "mcpServer/elicitation/request") {
		return elicitation(request.params, ui, signal);
	}
	throw new AppServerRpcError(-32601, "Method not supported by this client");
}
