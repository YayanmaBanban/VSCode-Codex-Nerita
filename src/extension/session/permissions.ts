// ACP の承認要求と UI の選択肢を対応づけ、一度だけ解決する。
import { randomUUID } from "node:crypto";
import type {
	RequestPermissionRequest,
	RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { Permission } from "../../shared/messages";
/** 保留要求の識別子と解決関数。 */
type PendingPermission = {
	permission: Permission;
	resolve: (response: RequestPermissionResponse) => void;
};
/** 停止・切断時にも保留要求を必ず解決する承認管理。 */
export class Permissions {
	private pending = new Map<string, PendingPermission>();
	/** 描画に必要な情報だけを返す。 */
	list(): Permission[] {
		return [...this.pending.values()].map((p) => p.permission);
	}
	/** エージェント由来の選択肢を保持して回答を待つ。 */
	request(
		request: RequestPermissionRequest,
	): Promise<RequestPermissionResponse> {
		const id = randomUUID();
		return new Promise((resolve) => {
			this.pending.set(id, {
				resolve,
				permission: {
					id,
					title: request.toolCall.title ?? "操作の承認",
					options: request.options.map((o) => ({
						id: o.optionId,
						name: o.name,
						kind: o.kind,
					})),
				},
			});
		});
	}
	/** 存在する要求と選択肢の組だけを受理する。 */
	respond(id: string, optionId: string): boolean {
		const pending = this.pending.get(id);
		if (!pending?.permission.options.some((o) => o.id === optionId)) {
			return false;
		}
		this.pending.delete(id);
		pending.resolve({ outcome: { outcome: "selected", optionId } });
		return true;
	}
	/** 承認待ちをすべて取消として解決する。 */
	cancelAll(): void {
		for (const pending of this.pending.values()) {
			pending.resolve({ outcome: { outcome: "cancelled" } });
		}
		this.pending.clear();
	}
}
