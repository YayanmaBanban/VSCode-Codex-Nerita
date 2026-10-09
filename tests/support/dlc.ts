// エージェントなしで状態機械を検証するため、Runtime 境界の観測結果を明示的に用意する。
import { createIntentState } from "@nerita/dlc/state";
import { currentCatalogDigest } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { applyAction } from "@nerita/dlc/transitions";
import type {
	RuntimeResult,
	ExecutionRequest,
	NeritaRuntimePort,
} from "@nerita/dlc/runtime";

export const testIntentId = "00000000-0000-4000-8000-000000000023";
export function createTestIntent() {
	return createIntentState(
		{
			schemaVersion: 1,
			spaceId: "default",
			intentId: testIntentId,
			title: "挨拶を変更する",
			request: "挨拶を変更する",
			createdAt: "2026-10-08T00:00:00Z",
		},
		{
			profileId: "classic",
			profileVersion: 1,
			catalogVersion: 1,
			catalogDigest: currentCatalogDigest,
			workspaceFingerprint: `sha256:${"0".repeat(64)}`,
			workspaceSchemaVersion: 1,
			detectorVersion: 1,
			projectTypeSource: "detected",
			effectiveProjectType: "brownfield",
		},
	);
}
export function plannedIntent() {
	return applyAction(createTestIntent(), {
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
	workItemId = "00000000-0000-4000-8000-000000000023:task:1",
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
