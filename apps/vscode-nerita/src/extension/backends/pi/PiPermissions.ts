// Pi の承認待機をターンの寿命へ結び付け、拒否をツールエラーとして返す。
import { Approvals } from "../../session/Approvals";
import type { PermissionPresentation } from "@nerita/shared/permission";
import type { CommandPermissions } from "../../runtime/CommandPermissions";
import type { CommandApprovalScope } from "@nerita/shared/commandPermission";

/** 実行中のターンだけが提供する取消境界。 */
type PermissionRun = {
	signal: AbortSignal;
	cancel: () => void;
};

/** 表示と回答は共通形式を使い、Pi 固有の拒否・中止をここで解釈する。 */
export class PiPermissions extends Approvals {
	/** 許可は1回限りとし、許可直後の `Stop` も実行前に検出する。 */
	async authorize(
		title: string | PermissionPresentation,
		run: PermissionRun,
		signal?: AbortSignal,
		grants?: CommandPermissions,
	) {
		const permission =
			typeof title === "string" ? undefined : title.commandPermission;
		const combined = AbortSignal.any([
			run.signal,
			...(signal ? [signal] : []),
		]);
		combined.throwIfAborted();
		const scoped = permission && grants;
		if (scoped && grants.has(permission)) {
			return AbortSignal.any([combined, grants.signal(permission)]);
		}
		const { decision } = await this.ask(title, [combined], Boolean(scoped));
		if (decision === "cancel") {
			run.cancel();
		}
		combined.throwIfAborted();
		if (
			!["accept", "accept-session", "accept-workspace"].includes(decision)
		) {
			throw new Error(
				"ユーザーが実行を拒否しました。操作は実行されていません。",
			);
		}
		if (scoped) {
			await grants.allow(permission, approvalScope(decision));
		}
		combined.throwIfAborted();
		return scoped
			? AbortSignal.any([combined, grants.signal(permission)])
			: combined;
	}
}

/** 表示中の選択肢と照合済みの回答だけを保存範囲へ変換する。 */
function approvalScope(decision: string): CommandApprovalScope {
	if (decision === "accept-session") {
		return "session";
	}
	return decision === "accept-workspace" ? "workspace" : "once";
}
