// Pi の組み込みシェル結果から、表示本文と Host 内だけの一時出力参照を取り出す。
import type { ToolSummary } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import { lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { setToolOutputSource } from "../../../session/toolOutputSource";

/** 履歴から一時パスは復元しない。SDK が返す構造化本文を最優先する。 */
export function registerPiOutput(
	tool: ToolSummary,
	name: string,
	result: unknown,
	history: boolean,
) {
	if (
		!["bash", "powershell", "pwsh", "pnpm"].includes(name) ||
		!isRecord(result)
	) {
		return;
	}
	const structured = result.structuredContent;
	if (
		!isRecord(structured) ||
		typeof structured.output !== "string" ||
		typeof structured.truncated !== "boolean"
	) {
		registerContentOutput(tool, result, history);
		return;
	}
	if (Number.isSafeInteger(structured.exit_code)) {
		tool.exitCode = Number(structured.exit_code);
	}
	const path = history
		? undefined
		: allowedPiOutputPath(structured.full_output_path);
	setToolOutputSource(tool, {
		text: structured.output,
		truncated: structured.truncated,
		...(path && structured.truncated ? { path } : {}),
	});
}

/** 途中更新と保存履歴では、SDK の切り詰め情報を引き継ぎ、一時パスの案内を公開しない。 */
function registerContentOutput(
	tool: ToolSummary,
	result: Record<string, unknown>,
	history: boolean,
) {
	if (!Array.isArray(result.content)) {
		return;
	}
	const text = result.content
		.flatMap((part: unknown) =>
			isRecord(part) && typeof part.text === "string" ? [part.text] : [],
		)
		.join("\n");
	const details = isRecord(result.details) ? result.details : {};
	if (
		typeof details.exitCode === "number" &&
		Number.isSafeInteger(details.exitCode)
	) {
		tool.exitCode = details.exitCode;
	}
	const truncation =
		isRecord(details.truncation) && details.truncation.truncated === true;
	const path = history
		? undefined
		: allowedPiOutputPath(details.fullOutputPath);
	setToolOutputSource(tool, {
		text: text.replace(/\n\n\[Showing [^\n]*Full output: [^\n]*\]/gu, ""),
		truncated: truncation,
		...(path ? { path } : {}),
	});
}

/** Pi の一時出力命名とディレクトリを照合し、リンクや任意パスを拒否する。 */
function allowedPiOutputPath(value: unknown): string | undefined {
	if (
		typeof value !== "string" ||
		!/^pi-(?:bash|powershell)-[a-f0-9]{16}\.log$/u.test(basename(value))
	) {
		return;
	}
	try {
		const path = resolve(value);
		if (
			dirname(path) !== resolve(tmpdir()) ||
			!lstatSync(path).isFile() ||
			realpathSync(path) !== path
		) {
			return;
		}
		return path;
	} catch {
		return;
	}
}
