// 明示的な承認ルールを優先し、内容を限定できる通常操作だけをモデル審査から除く。
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { GuardResult } from "@nerita/shared/guardrails/messages";
import type { ToolCall } from "./ApprovedToolCall";
import {
	snapshotFile,
	verifyFileSnapshot,
	type FileSnapshot,
} from "./FileSnapshot";
import { WorkspacePathPolicy } from "./WorkspacePathPolicy";

/** 空配列は直接実行、未定義は審査が必要。明示ルールの承認は省略しない。 */
export async function directReviewFiles(
	call: ToolCall,
	result: GuardResult,
): Promise<FileSnapshot[] | undefined> {
	const explicit = result.rules.some(
		(id) => !["builtin:shell", "builtin:write"].includes(id),
	);
	if (explicit || call.hostShell === true) {
		return undefined;
	}
	if (call.file && ["write", "edit"].includes(call.tool)) {
		return sensitiveFile(call.file.path) ? undefined : [];
	}
	if (call.sandbox?.name !== "Microsoft MXC") {
		return undefined;
	}
	const command = call.params.command;
	if (typeof command !== "string") {
		return undefined;
	}
	return inspectSimpleCommand(call, command);
}

/** 起動設定や依存スクリプトの変更を通常のソース編集と分ける。 */
function sensitiveFile(input: string): boolean {
	const path = input.replaceAll("\\", "/");
	const directory =
		/(?:^|\/)(?:\.git|\.pi|\.nerita|\.vscode|\.github)(?:\/|$)/i.test(path);
	return (
		directory ||
		/^(?:package\.json|.*\.(?:cmd|ps1|sh)|.*rc)$/i.test(basename(path))
	);
}

/** MXC 内の表示専用コマンドと、内容を限定できるバッチだけを省略対象にする。 */
async function inspectSimpleCommand(
	call: ToolCall,
	input: string,
): Promise<FileSnapshot[] | undefined> {
	if (Object.keys(call.env ?? {}).length > 0) {
		return undefined;
	}
	const command = input.trim();
	const display =
		/^(?:pwd|Get-Location|Write-Output\s+'[^'\r\n]*'|Write-Output\s+"[^"$`\r\n]*"|echo[ \t]+[\w.-][\w .-]*)$/i.test(
			command,
		);
	if (display) {
		return [];
	}
	const match = /^(?:cmd(?:\.exe)?\s+\/c\s+)?([\w.\\/-]+\.bat)$/i.exec(
		command,
	);
	const path = match?.[1];
	if (path === undefined || path === "") {
		return undefined;
	}
	const paths = new WorkspacePathPolicy(call.policy, call.cwd);
	try {
		const resolved = await paths.resolve(path, "read");
		const info = await stat(resolved);
		if (info.size > 16384) {
			return undefined;
		}
		const snapshot = await snapshotFile(paths, path);
		const body = await readFile(snapshot.path, "utf8");
		if (!body.split(/\r?\n/).every(simpleBatchLine)) {
			return undefined;
		}
		await verifyFileSnapshot(paths, snapshot);
		return [snapshot];
	} catch {
		return undefined;
	}
}

/** cmd の展開・連結・リダイレクトを許可せず、表示専用の構文だけを扱う。 */
function simpleBatchLine(line: string): boolean {
	const value = line.trim().replace(/^@/, "");
	if (value === "" || /^exit[ \t]+\/b(?:[ \t]+0)?$/i.test(value)) {
		return true;
	}
	const index = value.search(/[ \t]/);
	const verb = (index < 0 ? value : value.slice(0, index)).toLowerCase();
	const rest = index < 0 ? "" : value.slice(index).trim();
	return ["echo", "rem"].includes(verb) && /^[\w .,-]*$/.test(rest);
}

/** 省略を決めた時点のスクリプトが、実行時にも同じ内容であることを検査する。 */
export async function verifyReviewFiles(call: ToolCall) {
	const paths = new WorkspacePathPolicy(call.policy, call.cwd);
	for (const file of call.reviewFiles ?? []) {
		await verifyFileSnapshot(paths, file);
	}
}
