// 拒否記録に対する UI の選択を Host の既知イベントと照合する。ここでは権限を自動適用しない。
import {
	resourceDecisionSchema,
	type DenialEvent,
	type ResourceDecision,
	type ResourceScope,
} from "@nerita/shared/sandboxPolicy";

/** 永続化するのは識別子と範囲のみ。秘密値を保存・通知しない。 */
export type ResourceApproval = {
	event: DenialEvent;
	decision: ResourceDecision;
	context: { processId: string; sessionId: string; workspaceId: string };
};

/** 操作時に現在の実行コンテキストを指定し、別セッションの要求を再利用しない。 */
export class ResourceApprovalStore {
	private readonly events = new Map<string, DenialEvent>();
	constructor(private readonly context: ResourceApproval["context"]) {}

	/** 拒否の登録だけでは権限も承認も発行しない。 */
	record(events: readonly DenialEvent[]): void {
		for (const event of events) {
			this.events.set(event.id, structuredClone(event));
		}
	}

	/** 任意パスや未分類のリソース、資格情報への直接アクセスは UI から許可できない。 */
	decide(input: unknown): ResourceApproval {
		const decision = resourceDecisionSchema.parse(input);
		const event = this.events.get(decision.eventId);
		if (!event) {
			throw new Error("拒否イベントが見つかりません。");
		}
		validateDecision(event, decision);
		this.events.delete(event.id);
		return {
			event: structuredClone(event),
			decision,
			context: { ...this.context },
		};
	}
}

/** 資源の既定権限を UI の操作種別によって緩和させない。 */
function validateDecision(
	event: DenialEvent,
	decision: ResourceDecision,
): void {
	if (decision.action !== "deny") {
		if (!event.resource || event.resourceType !== "file") {
			throw new Error("未分類のリソースは許可できません。");
		}
		if (
			decision.action === "allow" &&
			!["install", "helper"].includes(event.resource.kind)
		) {
			throw new Error(
				"このリソースは専用の設定・キャッシュ・資格情報処理が必要です。",
			);
		}
		if (
			decision.action === "allow" &&
			!["read", "execute"].includes(event.requestedAccess)
		) {
			throw new Error("ツール本体の書込みは許可できません。");
		}
		if (
			decision.action === "use-sandbox-cache" &&
			event.resource.kind !== "cache"
		) {
			throw new Error("キャッシュ以外の保存先は切り替えられません。");
		}
	}
}

/** Host ブローカーが明示承認と実行範囲を確認して値を返す。実装は資格情報プロバイダーが所有する。 */
export type CredentialBroker = {
	resolve(
		request: {
			resourceId: string;
			scope: ResourceScope;
			processId: string;
			sessionId: string;
			workspaceId: string;
		},
		signal: AbortSignal,
	): Promise<Record<string, string>>;
};
