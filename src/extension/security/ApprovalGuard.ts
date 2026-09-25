// 承認前に要求全体を固定し、既存 `Permission` UI から1回限りの `permit` を発行する。
import {
	freezeToolCall,
	issueApprovedToolCall,
	type ToolCall,
} from "./ApprovedToolCall";
import type { PermissionPresentation } from "../../shared/permission";
import { toolApprovalPresentation } from "./toolApprovalPresentation";
import { guardrailRegistry } from "./GuardrailRegistry";
import { evaluateGuardrails } from "./GuardrailEvaluator";
import {
	guardProbeSchema,
	type GuardResult,
} from "../../shared/guardrails/messages";

/** UI の許可と `Stop` を同じ寿命に結び付ける。 */
export type ToolAuthorizer = (
	presentation: PermissionPresentation,
	signal?: AbortSignal,
) => Promise<AbortSignal>;

/** Phase 11では毎回承認を基準とし、詳細解析の追加先を分離する。 */
export function assessToolCall(call: ToolCall): "allow" | "ask" {
	if ((call.command || call.hostShell) && !call.policy.shell) {
		throw new Error("このroleではShell実行が禁止されています。");
	}
	return !call.command &&
		!call.hostShell &&
		["read", "ls"].includes(call.tool)
		? "allow"
		: "ask";
}

/** `env` の値は表示せず、実行と同一の操作・cwd・実効範囲を提示する。 */
export async function approveToolCall(
	input: ToolCall,
	authorize: ToolAuthorizer,
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const snapshot = input.policy.guardrailsRoot
		? guardrailRegistry.snapshot(input.policy.guardrailsRoot, [
				input.policy.guardrailsRoot,
			])
		: guardrailRegistry.snapshot(input.cwd, input.policy.workspaceRoots);
	const combined = AbortSignal.any([
		snapshot.signal,
		...(signal ? [signal] : []),
	]);
	const call = freezeToolCall({
		...input,
		guardrailsDigest: snapshot.digest,
	});
	const decision = assessToolCall(call);
	const result = await evaluateGuardrails(
		snapshot.config,
		snapshot.root,
		call.policy.workspaceRoots,
		probeFor(call),
	);
	combined.throwIfAborted();
	if (result.action === "deny") {
		throw new Error(
			`ガードレールが実行を拒否しました: ${result.reasons.join(" / ")}`,
		);
	}
	const checkedCall = freezeToolCall({
		...call,
		guardrailsPaths: result.paths,
	});
	const presentation = guardPresentation(checkedCall, result);
	const approvalSignal =
		decision === "ask" || result.action === "ask"
			? await authorize(presentation, combined)
			: combined;
	return issueApprovedToolCall(
		checkedCall,
		AbortSignal.any([combined, approvalSignal]),
	);
}

/** 実行用の入力を検査専用の形式へ移し、未知の Tool を暗黙に許可しない。 */
function probeFor(call: ToolCall) {
	let input = call.file?.input ?? ".";
	if (typeof call.params.path === "string" && !call.file) {
		input = call.params.path;
	}
	if (typeof call.params.command === "string") {
		input = call.params.command;
	}
	return guardProbeSchema.parse({
		tool: call.tool.startsWith("extension:") ? "extension" : call.tool,
		input,
		cwd: call.cwd,
	});
}

/** 判定理由と解析できない範囲を既存の承認表示へ加える。 */
function guardPresentation(call: ToolCall, result: GuardResult) {
	const presentation = toolApprovalPresentation(call);
	if (result.paths.length) {
		presentation.fields?.push({
			id: "guardrails-paths",
			label: "正規化後の対象パス",
			value: result.paths.join("\n"),
			display: "text",
		});
	}
	presentation.fields?.push({
		id: "guardrails",
		label: "ガードレール判定",
		value: result.reasons.join("\n") || "追加の制限なし",
		display: "text",
	});
	if (result.uncertainties.length) {
		presentation.details?.push({
			id: "uncertainties",
			label: "確認が必要な範囲",
			value: result.uncertainties.join("\n"),
			display: "text",
		});
	}
	return presentation;
}
