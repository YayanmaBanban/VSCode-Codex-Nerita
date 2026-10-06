// バックエンド共通の1回限りの承認待機と取消を管理する。
import { randomUUID } from "node:crypto";
import type { Permission } from "@nerita/shared/chatState";
import type { PermissionPresentation } from "@nerita/shared/permission";
/** 1回の操作に適用する判断。 */
type Decision =
	"accept" | "decline" | "cancel" | "accept-session" | "accept-workspace";
/** 承認ごとの UUID を作り、取消・解決済み通知でも待機を終了する。 */
export class Approvals {
	private pending = new Map<
		string,
		{ permission: Permission; finish: (decision: Decision) => void }
	>();
	/** 承認一覧が変わるたびに、呼び出し側へ表示状態の更新を通知する。 */
	constructor(private readonly changed: () => void) {}
	/** UI が描画する承認だけを返す。 */
	list(): Permission[] {
		return [...this.pending.values()].map((entry) => entry.permission);
	}
	/** サーバー取消とターン取消の両方に追従し、今回だけの許可・拒否・中止を待つ。 */
	ask(
		presentation: string | PermissionPresentation,
		signals: AbortSignal[],
		scoped = false,
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
					...(typeof presentation === "string"
						? { title: presentation }
						: presentation),
					id,
					options: scoped
						? [
								{
									id: "accept",
									name: "今回だけ",
									kind: "allow",
								},
								{
									id: "accept-session",
									name: "セッション中",
									kind: "allow",
								},
								{
									id: "accept-workspace",
									name: "このワークスペース",
									kind: "allow",
								},
								{
									id: "cancel",
									name: "キャンセル",
									kind: "abort",
								},
							]
						: [
								{
									id: "accept",
									name: "今回のみ許可",
									kind: "allow",
								},
								{ id: "decline", name: "拒否", kind: "deny" },
								{
									id: "cancel",
									name: "ターンを中止",
									kind: "abort",
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
			!entry.permission.options.some((option) => option.id === decision)
		) {
			return false;
		}
		entry.finish(decision as Decision);
		return true;
	}
}
