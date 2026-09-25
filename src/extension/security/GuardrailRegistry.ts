// 適用済み設定だけを保持し、ファイルの書換えで権限が変わることを防ぐ。
import { createHash } from "node:crypto";
import {
	defaultGuardrails,
	parseGuardrails,
	type GuardrailsConfig,
} from "../../shared/guardrails/config";
import { containsPath } from "./AgentAccessPolicy";
import { freezeToolCall } from "./ApprovedToolCall";

/** 変更時に承認待ちと実行中の処理へ取消しを伝える世代。 */
type Entry = {
	config: GuardrailsConfig;
	digest: string;
	abort: AbortController;
};

/** 永続化は Pi の設定サービスが担当し、判定器は VS Code に依存しない。 */
export class GuardrailRegistry {
	private readonly entries = new Map<string, Entry>();
	/** 保存・検証済みの設定を適用し、旧世代を失効させる。 */
	apply(root: string, config: GuardrailsConfig): void {
		const frozen = freezeToolCall(parseGuardrails(JSON.stringify(config)));
		const digest = createHash("sha256")
			.update(JSON.stringify(frozen))
			.digest("hex");
		this.entries
			.get(root)
			?.abort.abort(
				new Error("ガードレールが変更されました。再承認が必要です。"),
			);
		this.entries.set(root, {
			config: frozen,
			digest,
			abort: new AbortController(),
		});
	}
	/** cwd を含む最も深い workspace の設定を採用する。 */
	snapshot(cwd: string, roots: string[]) {
		const root =
			roots
				.filter((path) => containsPath(path, cwd))
				.sort((a, b) => b.length - a.length)[0] ??
			roots[0] ??
			cwd;
		if (!this.entries.has(root)) {
			this.apply(root, defaultGuardrails());
		}
		const entry = this.entries.get(root)!;
		return {
			root,
			config: entry.config,
			digest: entry.digest,
			signal: entry.abort.signal,
		};
	}
	/** 復元できない設定を既定値へ緩めず、利用者の再適用まで実行を止める。 */
	block(root: string) {
		if (!this.entries.has(root)) {
			this.apply(root, defaultGuardrails());
		}
		this.entries
			.get(root)!
			.abort.abort(
				new Error(
					"適用済みガードレールを復元できません。エディターから再適用してください。",
				),
			);
	}
	/** workspace の終了時も古い承認を持ち越さない。 */
	dispose() {
		for (const entry of this.entries.values()) {
			entry.abort.abort();
		}
		this.entries.clear();
	}
}
export const guardrailRegistry = new GuardrailRegistry();
