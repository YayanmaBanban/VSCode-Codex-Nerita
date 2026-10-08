// エージェントなしで状態機械を検証するため、Runtime 境界の観測結果を明示的に用意する。
import { createProject } from "@nerita/dlc/state";
import { applyAction } from "@nerita/dlc/transitions";
import type {
	RuntimeResult,
	ExecutionRequest,
	NeritaRuntimePort,
} from "@nerita/dlc/runtime";

export function plannedProject() {
	return applyAction(createProject("project", "挨拶を変更する"), {
		type: "plan",
		tasks: [
			{
				title: "挨拶",
				instructions: "hello.txt を更新する",
				paths: ["hello.txt"],
			},
		],
	});
}
export function executionReceipt(
	attemptId = "attempt",
	workItemId = "project:task:1",
): RuntimeResult {
	return {
		semantic: {
			attemptId,
			workItemId,
			outcome: "implemented",
			summary: "挨拶を変更した",
			changedPaths: ["hello.txt"],
		},
		evidence: {
			attemptId,
			workItemId,
			outcome: "completed",
			before: {
				id: "before",
				baseCommit: "base",
				indexDigest: "index",
				complete: true,
				files: [{ path: "hello.txt", digest: "old" }],
			},
			after: {
				id: "after",
				baseCommit: "base",
				indexDigest: "index",
				complete: true,
				files: [{ path: "hello.txt", digest: "new" }],
			},
			tools: [
				{
					id: "write",
					kind: "edit",
					status: "completed",
					paths: ["hello.txt"],
				},
			],
			approvals: [],
			policy: "workspace-inherit",
		},
	};
}
export function successfulRuntime(
	onRun?: (request: ExecutionRequest) => void,
): NeritaRuntimePort {
	return {
		run: (request) => {
			onRun?.(request);
			return Promise.resolve(
				executionReceipt(request.attemptId, request.workItemId),
			);
		},
		stop: () => Promise.resolve(),
		status: () => ({ attemptId: null, running: false }),
	};
}
