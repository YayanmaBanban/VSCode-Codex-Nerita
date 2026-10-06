// npm 設定は既知の非秘密項目だけを複製する。未知のキー・補間・認証付き URL は引き継がない。
import { readFile, stat } from "node:fs/promises";

/** 入力をそのままログや例外に含めない。最大サイズを超える設定は空の設定として扱う。 */
export async function sanitizedNpmConfig(path: string): Promise<string> {
	try {
		if ((await stat(path)).size > 64 * 1024) {
			return "";
		}
		return sanitizeNpmText(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return "";
		}
		throw new Error("Sandbox 用 npm 設定を生成できません。", {
			cause: error,
		});
	}
}

/** 認証、プロキシー、スクリプト、外部設定の読み込み、任意パスをホストから持ち込まない。 */
function sanitizeNpmText(text: string): string {
	const output: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(
			/^\s*(registry|@[-\w.]+:registry|strict-ssl|fund|audit)\s*=([^\r\n]*)$/i,
		);
		if (!match) {
			continue;
		}
		const key = match[1]!.toLowerCase();
		const value = match[2]!.trim();
		if (key.endsWith("registry")) {
			if (safeRegistry(value)) {
				output.push(`${key}=${value}`);
			}
		} else if (
			/^(?:true|false)$/i.test(value) &&
			(key !== "strict-ssl" || value.toLowerCase() === "true")
		) {
			// ホスト設定から TLS 検証を無効にしない。
			output.push(`${key}=${value.toLowerCase()}`);
		}
	}
	return output.length > 0 ? `${output.join("\n")}\n` : "";
}

/** URL の認証情報・クエリー・フラグメント・環境変数補間は秘密情報を含み得るため除外する。 */
function safeRegistry(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			url.username === "" &&
			url.password === "" &&
			url.search === "" &&
			url.hash === "" &&
			!/[${}\s]/.test(value)
		);
	} catch {
		return false;
	}
}
