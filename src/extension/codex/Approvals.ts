// App Server のコマンド・ファイル承認を既存 UI の選択肢へ変換する。
import { randomUUID } from "node:crypto";
import type { CommandExecutionRequestApprovalResponse } from "../../codex-app-server/v2/CommandExecutionRequestApprovalResponse";
import type { Permission } from "../../shared/messages";
import { isRecord } from "../../shared/validation";
import { AppServerRpcError, type AppServerRequest } from "./protocol/rpcMessage";

/** Phase 1 で扱う、今回の操作だけに適用する承認判断。 */
type Decision = Extract<
	CommandExecutionRequestApprovalResponse["decision"],
	"accept" | "decline" | "cancel"
>;
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
	const title = [
		request.method === "item/fileChange/requestApproval"
			? "ファイル変更の承認"
			: params.kind === "writeStdin"
				? "端末への入力の承認"
				: "コマンド実行の承認",
	];
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
	return {
		threadId: params.threadId,
		turnId: params.turnId,
		itemId: params.itemId,
		title: title.join("\n"),
	};
}
/** 承認ごとの UUID を作り、取消・解決済み通知でも待機を終了する。 */
export class Approvals {
	private pending = new Map<
		string,
		{ permission: Permission; finish: (decision: Decision) => void }
	>();
	/** 表示が変わるたびに UI の正本を更新する。 */
	constructor(private readonly changed: () => void) {}
	/** UI が描画する承認だけを返す。 */
	list(): Permission[] {
		return [...this.pending.values()].map((entry) => entry.permission);
	}
	/** サーバー取消とターン取消の両方に追従し、今回だけの許可・拒否・中止を待つ。 */
	ask(
		title: string,
		signals: AbortSignal[],
	): Promise<{ decision: Decision }> {
		if (signals.some((signal) => signal.aborted)) {
			return Promise.resolve({ decision: "cancel" });
		}
		const id = randomUUID();
		return new Promise((resolve) => {
			/** 一度だけ解決し、全ての取消ハンドラーを取り外す。 */
			const finish = (decision: Decision) => {
				if (!this.pending.delete(id)) {
					return;
				}
				for (const signal of signals) {
					signal.removeEventListener("abort", cancel);
				}
				resolve({ decision });
				this.changed();
			};
			const cancel = () => finish("cancel");
			this.pending.set(id, {
				finish,
				permission: {
					id,
					title,
					options: [
						{
							id: "accept",
							name: "今回のみ許可",
							kind: "allow_once",
						},
						{ id: "decline", name: "拒否", kind: "reject_once" },
						{
							id: "cancel",
							name: "ターンを中止",
							kind: "reject_once",
						},
					],
				},
			});
			for (const signal of signals) {
				signal.addEventListener("abort", cancel, { once: true });
			}
			this.changed();
		});
	}
	/** 表示中の要求と許可された選択肢の組だけを受理する。 */
	respond(id: string, decision: string): boolean {
		const entry = this.pending.get(id);
		if (
			!entry ||
			(decision !== "accept" &&
				decision !== "decline" &&
				decision !== "cancel")
		) {
			return false;
		}
		entry.finish(decision);
		return true;
	}
}
