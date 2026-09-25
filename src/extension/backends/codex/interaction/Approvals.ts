// App Server のコマンド・ファイル承認を既存 UI の選択肢へ変換する。
import { isRecord } from "../../../../shared/validation";
import type {
	PermissionField,
	PermissionPresentation,
} from "../../../../shared/permission";
import {
	AppServerRpcError,
	type AppServerRequest,
} from "../protocol/rpcMessage";

/** 承認の実行範囲と表示情報だけを保持する。 */
export type ApprovalRequest = {
	threadId: string;
	turnId: string;
	itemId: string;
	presentation: PermissionPresentation & { fields: PermissionField[] };
};
/** 対応する要求の範囲と表示情報を検証する。 */
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
	const presentation = approvalDetails(request, params);
	return {
		threadId: params.threadId,
		turnId: params.turnId,
		itemId: params.itemId,
		presentation,
	};
}
export { Approvals } from "../../../session/Approvals";

/** ネットワーク承認と実行詳細を表示項目へ変換する。 */
function approvalDetails(
	request: AppServerRequest,
	params: Record<string, unknown>,
): ApprovalRequest["presentation"] {
	const presentation: ApprovalRequest["presentation"] = {
		title: approvalTitle(request.method, params.kind),
		fields: [],
	};
	if (isRecord(params.networkApprovalContext)) {
		const context = params.networkApprovalContext;
		if (
			typeof context.host !== "string" ||
			typeof context.protocol !== "string"
		) {
			throw new AppServerRpcError(-32602, "Invalid network approval");
		}
		presentation.title = "ネットワーク接続の承認";
		presentation.fields.push({
			id: "network",
			label: "接続先",
			value: `${context.protocol}://${context.host}`,
			display: "text",
		});
	}
	for (const field of ["command", "cwd", "reason", "grantRoot"] as const) {
		const value = approvalString(params[field]);
		if (value) {
			if (field === "command" || field === "cwd") {
				presentation[field] = value;
			} else {
				presentation.fields.push({
					id: field,
					label: field === "reason" ? "理由" : "書込み許可",
					value,
					display: "text",
				});
			}
		}
	}
	return presentation;
}

/** 任意の文字列項目は未指定だけを許し、異なる型は拒否する。 */
function approvalString(value: unknown): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new AppServerRpcError(-32602, "Invalid approval details");
	}
	return value;
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
