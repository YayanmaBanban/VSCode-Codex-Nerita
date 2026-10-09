// 実行中の承認と追加質問を、同じターンの寿命に限定する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import type { ChatState } from "@nerita/shared/chatState";
import { relative, resolve } from "node:path";
import { isManagedDlcPath } from "@nerita/shared/dlc/managedPaths";
import { canonicalPath } from "../../security/WorkspacePathPolicy";
import type { InteractionService } from "./interaction/interactionService";
import type { ActiveTurn } from "./ActiveTurn";
import {
	Approvals,
	parseApproval,
	type ApprovalRequest,
} from "./interaction/Approvals";
import type { AppServerRequest } from "./protocol/rpcMessage";
import { isRecord } from "@nerita/shared/validation";
import { interactionRequest } from "./interaction/interactionRequests";
import { permissionProfile } from "./settings/permissionProfile";

/** 同じターンの参照を返し、開始待ちの前後で対象が切り替わったか照合する。 */
type RequestSession = {
	snapshot: () => Readonly<ChatState>;
	active: () =>
		| Readonly<Pick<ActiveTurn, "threadId" | "turnId" | "ready" | "abort">>
		| undefined;
	patch: (change: Partial<ChatState>) => void;
};

/** 承認と入力要求を停止・切断・サーバー側取消へ追従させる。 */
export class CodexRequests {
	private interactionTail: Promise<unknown> = Promise.resolve();
	private readonly approvals = new Approvals(() =>
		this.session.patch({ permissions: this.approvals.list() }),
	);
	constructor(
		private readonly session: RequestSession,
		private readonly interactions?: InteractionService,
	) {}

	/** 表示中の承認要求へ利用者の選択を返し、承認の中止に伴うターン停止はコントローラーへ委ねる。 */
	respond(permissionId: string, optionId: string): boolean {
		return this.approvals.respond(permissionId, optionId);
	}

	/** サーバーからの要求が現在の実行に属するか確認し、取消済みの承認は表示しない。 */
	async request(
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
		const run = this.session.active();
		if (!run || approval.threadId !== run.threadId) {
			return { decision: "cancel" };
		}
		await run.ready;
		if (
			this.session.active() !== run ||
			approval.turnId !== run.turnId ||
			this.session.snapshot().run !== "running" ||
			signal.aborted
		) {
			return { decision: "cancel" };
		}
		const state = this.session.snapshot();
		const tool = state.tools.find(
			(item) => item.id === approval.itemId && item.runId === state.runId,
		);
		if (await managedFileChange(message.method, state, tool)) {
			return { decision: "decline" };
		}
		approvalPaths(approval, tool);
		return this.approvals.ask(approval.presentation, [
			signal,
			run.abort.signal,
		]);
	}

	/** 実行中の質問・フォーム・追加権限の要求を処理する。 */
	private async interaction(
		message: AppServerRequest,
		signal: AbortSignal,
	): Promise<unknown> {
		const run = this.session.active();
		const p = message.params;
		const empty = cancelledInteraction(message.method);
		if (!run || !isRecord(p) || p.threadId !== run.threadId) {
			return empty;
		}
		await run.ready;
		if (
			this.session.active() !== run ||
			(p.turnId !== null && p.turnId !== run.turnId) ||
			this.session.snapshot().run !== "running" ||
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
				{
					title: "追加権限の承認（このターンのみ）",
					fields: [
						...(typeof p.reason === "string" && p.reason !== ""
							? [
									{
										id: "reason",
										label: "理由",
										value: p.reason,
										display: "text" as const,
									},
								]
							: []),
						{
							id: "permissions",
							label: "要求する権限",
							value: JSON.stringify(permissions, null, 2),
							display: "code",
						},
					],
				},
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

function approvalPaths(
	approval: ApprovalRequest,
	tool: ChatState["tools"][number] | undefined,
): void {
	if (isNonZeroNumber(tool?.paths.length)) {
		approval.presentation.fields = [
			...approval.presentation.fields,
			{
				id: "paths",
				label: "対象ファイル",
				value: tool.paths.join("\n"),
				display: "text",
			},
		];
	}
}

/** App Server が承認を要求した既知の変更対象にも Host 管理領域の制限を適用する。 */
async function managedFileChange(
	method: string,
	state: Readonly<ChatState>,
	tool: ChatState["tools"][number] | undefined,
): Promise<boolean> {
	if (
		method !== "item/fileChange/requestApproval" ||
		state.cwd === null ||
		!tool
	) {
		return false;
	}
	const cwd = tool.cwd ?? state.cwd;
	for (const input of tool.paths) {
		const paths = [resolve(cwd, input), await canonicalPath(input, cwd)];
		if (
			paths.some((path) =>
				isManagedDlcPath(
					relative(state.cwd ?? cwd, path).replaceAll("\\", "/"),
				),
			)
		) {
			return true;
		}
	}
	return false;
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
