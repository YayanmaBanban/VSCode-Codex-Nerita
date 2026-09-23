// 実行中の承認と追加質問を、同じturnの寿命に限定する。
import { CodexOptions } from "./CodexOptions";
import type { ActiveTurn } from "./ActiveTurn";
import { Approvals, parseApproval } from "./interaction/Approvals";
import type { AppServerRequest } from "./protocol/rpcMessage";
import { isRecord } from "../../../shared/validation";
import { interactionRequest } from "./interaction/interactionRequests";
import { permissionProfile } from "./settings/permissionProfile";
/** 承認と入力要求を停止・切断・サーバー側取消へ追従させる。 */
export abstract class CodexRequests extends CodexOptions {
	private interactionTail: Promise<unknown> = Promise.resolve();
	protected active: ActiveTurn | undefined;
	protected readonly approvals = new Approvals(() =>
		this.patch({ permissions: this.approvals.list() }),
	);
	/** server request の実行範囲を確認し、取消済みの承認は表示しない。 */
	protected override async request(
		message: AppServerRequest,
		signal: AbortSignal,
	): Promise<unknown> {
		if (
			[
				"item/tool/requestUserInput",
				"mcpServer/elicitation/request",
				"item/permissions/requestApproval",
			].includes(message.method)
		) {
			return this.interaction(message, signal);
		}
		const approval = parseApproval(message);
		const run = this.active;
		if (!run || approval.threadId !== run.threadId) {
			return { decision: "cancel" };
		}
		await run.ready;
		if (
			this.active !== run ||
			approval.turnId !== run.turnId ||
			this.state.run !== "running" ||
			signal.aborted
		) {
			return { decision: "cancel" };
		}
		const tool = this.state.tools.find(
			(item) =>
				item.id === approval.itemId && item.runId === this.state.runId,
		);
		const detail = tool?.paths.length ? `\n${tool.paths.join("\n")}` : "";
		return this.approvals.ask(approval.title + detail, [
			signal,
			run.abort.signal,
		]);
	}

	/** 実行中の質問・フォーム・追加権限の要求を処理する。 */
	private async interaction(
		message: AppServerRequest,
		signal: AbortSignal,
	): Promise<unknown> {
		const run = this.active;
		const p = message.params;
		const empty = cancelledInteraction(message.method);
		if (!run || !isRecord(p) || p.threadId !== run.threadId) {
			return empty;
		}
		await run.ready;
		if (
			this.active !== run ||
			(p.turnId !== null && p.turnId !== run.turnId) ||
			this.state.run !== "running" ||
			signal.aborted
		) {
			return empty;
		}
		const combined = AbortSignal.any([signal, run.abort.signal]);
		return this.collectInteraction(message, p, combined, empty);
	}

	/** 対話を直列化し、取消後の結果を返さない。 */
	private async collectInteraction(
		message: AppServerRequest,
		p: Record<string, unknown>,
		combined: AbortSignal,
		empty: ReturnType<typeof cancelledInteraction>,
	): Promise<unknown> {
		if (message.method === "item/permissions/requestApproval") {
			const permissions = permissionProfile(p.permissions);
			const choice = await this.approvals.ask(
				`追加権限の承認（このターンのみ）\n${typeof p.reason === "string" ? p.reason : ""}\n${JSON.stringify(permissions, null, 2)}`,
				[combined],
			);
			return {
				permissions: choice.decision === "accept" ? permissions : {},
				scope: "turn",
			};
		}
		if (!this.interactions) {
			return empty;
		}
		try {
			const ui = this.interactions;
			const operation = this.interactionTail.then(() =>
				combined.aborted
					? empty
					: interactionRequest(message, ui, combined),
			);
			this.interactionTail = operation.catch(() => undefined);
			return await operation;
		} catch (error) {
			if (combined.aborted) {
				return empty;
			}
			throw error;
		}
	}
}

/** 実行対象がない対話要求へ、種類に合った取消結果を返す。 */
function cancelledInteraction(method: string) {
	if (method === "item/tool/requestUserInput") {
		return { answers: {} };
	}
	if (method === "item/permissions/requestApproval") {
		return { permissions: {}, scope: "turn" };
	}
	return { action: "cancel", content: null, _meta: null };
}
