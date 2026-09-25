// 固定済みの実行要求から、承認判断に必要な条件と補足情報を取り出す。
import type {
	PermissionField,
	PermissionPresentation,
} from "../../shared/permission";
import type { ToolCall } from "./ApprovedToolCall";

/** 実行用の環境変数を渡さず、コマンド本文と実際の引数を分けて表示する。 */
export function toolApprovalPresentation(
	call: ToolCall,
): PermissionPresentation {
	const command =
		typeof call.params.command === "string"
			? call.params.command
			: undefined;
	const fields: PermissionField[] = [];
	const details: PermissionField[] = [];
	executionFields(call, fields, details);
	// コマンド以外の入力も省略せず、ファイル本文などは常時表示する。
	const params = Object.fromEntries(
		Object.entries(call.params).filter(
			([key]) => key !== "command" || command === undefined,
		),
	);
	if (Object.keys(params).length) {
		(command === undefined ? fields : details).push(
			field(
				"params",
				"入力内容",
				JSON.stringify(params, null, 2),
				"code",
			),
		);
	}
	return {
		title: `Pi: ${call.tool} の実行承認`,
		cwd: call.cwd,
		...(command !== undefined && { command }),
		fields,
		details,
	};
}

/** 項目名と表示形式を揃えて承認用の値を作る。 */
function field(
	id: string,
	label: string,
	value: string,
	display: PermissionField["display"] = "text",
): PermissionField {
	return { id, label, value, display };
}

/** Host 実行にサンドボックスの保証を付けない。 */
function executionScope(call: ToolCall): string {
	if (call.hostShell) {
		return "Pi Shell（OSの権限で実行）";
	}
	if (call.tool.startsWith("extension:")) {
		return "明示的に信頼した拡張（Host権限・Sandbox外、通信を含む）";
	}
	return call.command ? "Shell Sandbox" : "HostファイルTool（Sandbox外）";
}

/** 実効権限と、実際に実行する引数・制限を表示項目へ加える。 */
function executionFields(
	call: ToolCall,
	fields: PermissionField[],
	details: PermissionField[],
) {
	fields.push(field("scope", "実行範囲", executionScope(call)));
	if (!call.hostShell && !call.tool.startsWith("extension:")) {
		fields.push(
			field(
				"writableRoots",
				"書込み許可",
				call.policy.writableRoots.join("\n") || "なし（readOnly）",
			),
		);
		if (call.command) {
			fields.push(
				field(
					"network",
					"Shell network設定",
					call.policy.networkAccess ? "許可" : "無効",
				),
			);
			details.push(
				field(
					"argv",
					"実行argv",
					JSON.stringify(call.command, null, 2),
					"code",
				),
			);
			if (call.timeoutMs !== undefined) {
				details.push(
					field("timeout", "制限時間", `${call.timeoutMs} ms`),
				);
			}
			if (call.sandbox) {
				details.push(
					field("sandbox", "Sandbox実装", call.sandbox.name),
				);
				call.sandbox.details.forEach((value, index) =>
					details.push(
						field(`sandbox-${index}`, "Sandbox設定", value),
					),
				);
			}
		}
	}
}
