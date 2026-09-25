// 承認前に要求全体を固定し、既存Permission UIから一回限りのpermitを発行する。
import {
	freezeToolCall,
	issueApprovedToolCall,
	type ToolCall,
} from "./ApprovedToolCall";

/** UIの許可とStopを同じ寿命に結び付ける。 */
export type ToolAuthorizer = (
	title: string,
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

/** envの値は表示せず、実行と同一の操作・cwd・実効範囲を提示する。 */
export async function approveToolCall(
	input: ToolCall,
	authorize: ToolAuthorizer,
	signal?: AbortSignal,
) {
	signal?.throwIfAborted();
	const call = freezeToolCall(input);
	const decision = assessToolCall(call);
	const approvalSignal =
		decision === "ask"
			? await authorize(
					[
						`Pi: ${call.tool} の実行承認`,
						`作業フォルダー: ${call.cwd}`,
						JSON.stringify(call.params, null, 2),
						...approvalContext(call),
					].join("\n"),
					signal,
				)
			: (signal ?? new AbortController().signal);
	return issueApprovedToolCall(
		call,
		signal ? AbortSignal.any([signal, approvalSignal]) : approvalSignal,
	);
}

/** Host実行にShell Sandboxの保証を付けない。 */
function approvalContext(call: ToolCall): string[] {
	if (call.hostShell) {
		return ["実行範囲: Pi Shell（OSの権限で実行）"];
	}
	if (call.tool.startsWith("extension:")) {
		return [
			"実行範囲: 明示的に信頼した拡張（Host権限・Sandbox外、通信を含む）",
		];
	}
	const context = [
		`実行範囲: ${call.command ? "Shell Sandbox" : "HostファイルTool（Sandbox外）"}`,
		`書込み許可: ${call.policy.writableRoots.join(", ") || "なし（readOnly）"}`,
	];
	if (call.command) {
		context.push(
			`実行argv: ${JSON.stringify(call.command)}`,
			`制限時間: ${call.timeoutMs} ms`,
			`Shell network設定: ${call.policy.networkAccess ? "許可" : "無効"}`,
			...(call.sandbox
				? [`Sandbox実装: ${call.sandbox.name}`, ...call.sandbox.details]
				: []),
		);
	}
	return context;
}
