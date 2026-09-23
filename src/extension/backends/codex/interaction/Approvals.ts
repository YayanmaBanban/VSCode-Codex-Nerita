// App Server のコマンド・ファイル承認を既存 UI の選択肢へ変換する。
import { isRecord } from "../../../../shared/validation";
import {
	AppServerRpcError,
	type AppServerRequest,
} from "../protocol/rpcMessage";

/** 承認の実行範囲と表示情報だけを保持する。 */
export type ApprovalRequest = {
	threadId: string;
	turnId: string;
	itemId: string;
	title: string;
};
/** 対応する要求の範囲と表示用文字列を検証する。 */
export function parseApproval(request: AppServerRequest): ApprovalRequest {
	if (
		![
			"item/commandExecution/requestApproval",
			"item/fileChange/requestApproval",
		].includes(request.method)
	) {
		throw new AppServerRpcError(
			-32601,
			"Method not supported by this client",
		);
	}
	const params = request.params;
	if (
		!isRecord(params) ||
		typeof params.threadId !== "string" ||
		typeof params.turnId !== "string" ||
		typeof params.itemId !== "string"
	) {
		throw new AppServerRpcError(-32602, "Invalid approval request");
	}
	const title = approvalDetails(request, params);
	return {
		threadId: params.threadId,
		turnId: params.turnId,
		itemId: params.itemId,
		title: title.join("\n"),
	};
}
export { Approvals } from "../../../session/Approvals";

/** ネットワーク承認と実行詳細の表示文字列を検証する。 */
function approvalDetails(
	request: AppServerRequest,
	params: Record<string, unknown>,
) {
	const title = [approvalTitle(request.method, params.kind)];
	if (isRecord(params.networkApprovalContext)) {
		const context = params.networkApprovalContext;
		if (
			typeof context.host !== "string" ||
			typeof context.protocol !== "string"
		) {
			throw new AppServerRpcError(-32602, "Invalid network approval");
		}
		title[0] = `ネットワーク接続の承認: ${context.protocol}://${context.host}`;
	}
	for (const field of ["command", "cwd", "reason", "grantRoot"] as const) {
		if (
			params[field] !== null &&
			params[field] !== undefined &&
			typeof params[field] !== "string"
		) {
			throw new AppServerRpcError(-32602, "Invalid approval details");
		}
		if (typeof params[field] === "string" && params[field]) {
			title.push(params[field]);
		}
	}
	return title;
}

/** ファイル変更・端末入力・コマンド実行を承認タイトルで区別する。 */
function approvalTitle(method: string, kind: unknown) {
	if (method === "item/fileChange/requestApproval") {
		return "ファイル変更の承認";
	}
	if (kind === "writeStdin") {
		return "端末への入力の承認";
	}
	return "コマンド実行の承認";
}
