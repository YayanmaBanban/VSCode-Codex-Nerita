// 導入済みの対応版からスクリプト実行部だけを読み込み、子起動は Host へ戻す。
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { containsPath } from "../../../security/AgentAccessPolicy";
import { isRecord } from "../../../../shared/validation";

/** Worker へ返す値はサイズを制限した JSON のみとする。 */
export type WorkflowResult = {
	key: string;
	runId: string;
	ok: boolean;
	output: string;
	artifactPaths: string[];
};
/** 内部 API の利用箇所をここへ集め、パッケージ更新時の検証対象を固定する。 */
export type PiWorkflowEngine = {
	validateWorkflowScript(script: string): { ok: boolean; errors: unknown[] };
	runWorkflowScript(options: {
		script: string;
		signal: AbortSignal;
		timeoutMs: number;
		globalConcurrencyLimit: number;
		launch: (
			key: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
		) => Promise<WorkflowResult>;
		status: (id: string, signal: AbortSignal) => Promise<WorkflowResult>;
	}): Promise<{ value: unknown }>;
};

/** 任意パスや別バージョンへフォールバックしない。拡張の index は実行しない。 */
export async function loadWorkflowEngine(
	directory: string,
): Promise<PiWorkflowEngine> {
	const root = await realpath(directory);
	const metadata: unknown = JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	);
	if (
		!isRecord(metadata) ||
		metadata.name !== "pi-subagents" ||
		metadata.version !== "0.71.0"
	) {
		throw new Error("ワークフローには pi-subagents 0.71.0 が必要です。");
	}
	const path = await realpath(
		join(root, "src/workflows/scripted-workflow.js"),
	);
	if (!containsPath(root, path)) {
		throw new Error("実行エンジンのパスが範囲外です。");
	}
	const engine: unknown = await import(pathToFileURL(path).href);
	if (!isEngine(engine)) {
		throw new Error("ワークフロー実行 API がありません。");
	}
	return engine;
}

/** 動的読込みの結果を未検証のまま使用しない。 */
function isEngine(value: unknown): value is PiWorkflowEngine {
	return (
		isRecord(value) &&
		typeof value.runWorkflowScript === "function" &&
		typeof value.validateWorkflowScript === "function"
	);
}
