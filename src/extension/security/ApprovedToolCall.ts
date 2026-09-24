// 承認対象の内容をコピー・固定し、実行直前に同一性と一回限りの許可を検査する。
import { createHash } from "node:crypto";
import type { AgentAccessPolicy } from "./AgentAccessPolicy";

/** backendに依存しない実行要求。commandは承認前に確定する。 */
export type ToolCall = {
	tool: string;
	params: Record<string, unknown>;
	cwd: string;
	policy: AgentAccessPolicy;
	command?: string[];
	env?: Record<string, string | null>;
	timeoutMs?: number;
};
export type ApprovedToolCall = Readonly<{
	call: ToolCall;
	fingerprint: string;
	signal: AbortSignal;
}>;
const permits = new WeakSet<ApprovedToolCall>();

/** 入力の参照を切り、配列・ネストも変更不能にする。 */
export function freezeToolCall<T>(value: T): T {
	const copy = structuredClone(value);
	const freeze = (item: unknown): void => {
		if (item && typeof item === "object") {
			Object.values(item).forEach(freeze);
			Object.freeze(item);
		}
	};
	freeze(copy);
	return copy;
}

/** Hostが正規化した同一形式をdigestへ変換する。 */
export function toolCallFingerprint(call: ToolCall): string {
	return createHash("sha256").update(JSON.stringify(call)).digest("hex");
}

/** Guardだけが承認後に発行し、シリアライズした偽の許可を受け付けない。 */
export function issueApprovedToolCall(
	call: ToolCall,
	signal: AbortSignal,
): ApprovedToolCall {
	signal.throwIfAborted();
	const frozen = freezeToolCall(call);
	const permit = Object.freeze({
		call: frozen,
		fingerprint: toolCallFingerprint(frozen),
		signal,
	});
	permits.add(permit);
	return permit;
}

/** コピー・改変・再利用された要求は再承認を必要とする。 */
export function consumeApprovedToolCall(permit: ApprovedToolCall): ToolCall {
	permit.signal.throwIfAborted();
	if (
		!permits.delete(permit) ||
		toolCallFingerprint(permit.call) !== permit.fingerprint
	) {
		throw new Error("承認内容が一致しません。再承認が必要です。");
	}
	return permit.call;
}
