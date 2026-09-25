// Pi の承認待機をターンの寿命へ結び付け、拒否をツールエラーとして返す。
import { Approvals } from "../../session/Approvals";
import type { PermissionPresentation } from "../../../shared/permission";

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
	) {
		const { decision } = await this.ask(title, [
			run.signal,
			...(signal ? [signal] : []),
		]);
		if (decision === "cancel") {
			run.cancel();
		}
		run.signal.throwIfAborted();
		signal?.throwIfAborted();
		if (decision !== "accept") {
			throw new Error(
				"ユーザーが実行を拒否しました。操作は実行されていません。",
			);
		}
		return run.signal;
	}
}
