// 同梱された Windows x64 用 Codex のバージョンと起動パスを検証する。
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "../../../../shared/validation";

/** 外部の PATH やグローバル CLI に依存せず、VSIX 内の実行ファイルを返す。 */
export async function resolveCodexExecutable(
	extensionPath: string,
): Promise<string> {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Codex App Server は Windows x64 に対応しています。");
	}
	const root = path.join(extensionPath, "dist/runtime/node_modules/@openai");
	const project: unknown = JSON.parse(
		await readFile(path.join(extensionPath, "package.json"), "utf8"),
	);
	const codex: unknown = JSON.parse(
		await readFile(path.join(root, "codex/package.json"), "utf8"),
	);
	if (
		!isRecord(project) ||
		!isRecord(project.dependencies) ||
		!isRecord(codex) ||
		typeof codex.version !== "string" ||
		project.dependencies["@openai/codex"] !== codex.version
	) {
		throw new Error(
			"同梱 Codex のバージョンが一致しません。拡張機能を再ビルドしてください。",
		);
	}
	const executable = path.join(
		root,
		"codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
	);
	if (!(await stat(executable)).isFile()) {
		throw new Error("同梱 Codex の実行ファイルがありません。");
	}
	return executable;
}
