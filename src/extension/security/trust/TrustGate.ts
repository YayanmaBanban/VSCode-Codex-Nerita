// モデルから渡された信頼値を使用せず、Host 登録の実行コンテキストを参照する。
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ToolCall } from "../ApprovedToolCall";
import { containsPath } from "../AgentAccessPolicy";
import { type WorkspaceTrustStore } from "./WorkspaceTrustStore";
import { commandTrustTargets } from "./TrustCommandTargets";

/** 子は親のコンテキストを共有し、信頼の上限を拡大しない。 */
type Context = {
	store: WorkspaceTrustStore;
	enabled: () => boolean;
	roots: string[];
};
const contexts = new Map<string, Context>();

/** ID は Host 内の policy にだけ格納し、セッション終了時に回収する。 */
export function bindTrustContext(
	store: WorkspaceTrustStore,
	roots: string[],
	enabled: () => boolean,
) {
	const id = randomUUID();
	contexts.set(id, { store, roots: [...roots], enabled });
	return { id, dispose: () => contexts.delete(id) };
}

/** 純粋な Host 読取り以外は、登録済みの信頼状態を必須とする。 */
export async function evaluateTrust(
	call: ToolCall,
): Promise<AbortSignal | undefined> {
	if (isReadOnly(call)) {
		return undefined;
	}
	const context = call.policy.trustContextId
		? contexts.get(call.policy.trustContextId)
		: undefined;
	if (!context) {
		throw new Error(
			"Workspace Trustを解決できないため実行を拒否しました。",
		);
	}
	const signal = context.store.signal;
	const paths = [
		call.cwd,
		...context.roots,
		...executionRoots(call),
		...commandTrustTargets(call),
	];
	if (typeof call.params.path === "string") {
		paths.push(resolve(call.cwd, call.params.path));
	}
	const trusted =
		context.enabled() &&
		(
			await Promise.all(paths.map((path) => context.store.trusted(path)))
		).every(Boolean);
	// 任意コマンドは同じ root 内の未信頼ツリーにも到達できるため、混在時は実行を止める。
	const mixed = containsUntrustedCode(call, context, paths);
	if (!trusted || mixed) {
		context.store.audit("execution-denied", call.cwd);
		throw new Error(
			"未信頼のWorkspaceまたは外部コードが含まれるため実行を拒否しました。Trust操作が必要です。",
		);
	}
	signal.throwIfAborted();
	return signal;
}

/** 複数の root を許可した実行基盤へ渡す場合は、そのすべてを実行対象として判定する。 */
function executionRoots(call: ToolCall): string[] {
	return call.command || call.hostShell || call.tool.startsWith("extension:")
		? call.policy.workspaceRoots
		: [];
}

/** 拡張ツールの自己申告した名前では読取り許可を与えない。 */
function isReadOnly(call: ToolCall): boolean {
	return (
		!call.command &&
		!call.hostShell &&
		(["read", "ls", "grep", "find"].includes(call.tool) ||
			call.externalRead === true)
	);
}

/** 実行対象に未信頼ツリーを含む場合は、cwd の信頼だけで許可しない。 */
function containsUntrustedCode(
	call: ToolCall,
	context: Context,
	paths: string[],
): boolean {
	return (
		!!(
			call.command ||
			call.hostShell ||
			call.tool.startsWith("extension:")
		) &&
		context.store
			.list()
			.some(
				(record) =>
					record.trust === "untrusted" &&
					paths.some((root) => containsPath(root, record.root)),
			)
	);
}
