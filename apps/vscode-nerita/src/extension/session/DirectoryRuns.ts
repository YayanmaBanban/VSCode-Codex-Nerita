// チャット・DLC・ワークフローの書込み実行を、実体ディレクトリごとに排他制御する。
import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { containsPath } from "../security/AgentAccessPolicy";
import type { ChatState } from "@nerita/shared/chatState";
import { taskActive } from "@nerita/shared/asyncTask";

export type DirectoryRun = { token: string; root: string; pid: number };
export type DirectoryRunStorage = {
	update(
		operation: (records: DirectoryRun[]) => DirectoryRun[],
	): Promise<void>;
};

/** 保存領域を持たない経路でも、同じ Host 内の実行は同じ一覧で照合する。 */
const localRuns: DirectoryRun[] = [];
const localStorage: DirectoryRunStorage = {
	update: (operation) => {
		const next = operation(localRuns);
		localRuns.splice(0, localRuns.length, ...next);
		return Promise.resolve();
	},
};

/** 開始前の競合は実行失敗と区別し、別の Worktree への切替を案内する。 */
export class DirectoryRunConflictError extends Error {
	constructor() {
		super(
			"この作業ディレクトリでは別の実行が進行中です。独立した Worktree を選択するか、終了後に再確認してください。",
		);
		this.name = "DirectoryRunConflictError";
	}
}

export class DirectoryRuns {
	constructor(private storage: DirectoryRunStorage = localStorage) {}

	/** ジャンクションや大文字・小文字の差を考慮し、親子ディレクトリでの同時実行も拒否する。 */
	async acquire(root: string): Promise<() => Promise<void>> {
		const actual = await realpath(root);
		const run = { token: randomUUID(), root: actual, pid: process.pid };
		await this.storage.update((records) => {
			const active = records.filter(
				(record) => !processExited(record.pid),
			);
			if (
				active.some(
					(record) =>
						containsPath(record.root, actual) ||
						containsPath(actual, record.root),
				)
			) {
				throw new DirectoryRunConflictError();
			}
			return [...active, run];
		});
		return () =>
			this.storage.update((records) =>
				records.filter((record) => record.token !== run.token),
			);
	}
}

/** アクセス拒否や不明な PID を、終了した所有者とみなさない。 */
function processExited(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (
			error instanceof Error && "code" in error && error.code === "ESRCH"
		);
	}
}

/** メイン応答の後も動くコマンド・子エージェントがあれば、実行先の予約を維持する。 */
export function sessionWriting(state: ChatState): boolean {
	const activeRun =
		state.run === "running" ||
		state.run === "cancelling" ||
		state.tools.some(
			(tool) =>
				tool.status === "in_progress" || tool.status === "pending",
		);
	return (
		activeRun ||
		state.agents.some((agent) =>
			["running", "pendingInit"].includes(agent.status),
		) ||
		state.asyncTasks.some(taskActive)
	);
}
