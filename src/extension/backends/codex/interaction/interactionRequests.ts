// サーバーからの質問・MCP フォームを、取消可能な Host の入力 UI へ接続する。
import { isRecord } from "../../../../shared/validation";
import {
	AppServerRpcError,
	type AppServerRequest,
} from "../protocol/rpcMessage";

import type { InteractionService } from "./interactionService";
import { userInput } from "./userInput";
import { elicitation } from "./elicitation";

/** クライアントが提供していない動的ツールや認証更新の要求は受け付けない。 */
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
