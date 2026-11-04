// 生成済みの対応バージョン・公式配布先・ハッシュを読み込み、実行時のダウンロードに使う。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const releaseSchema = z.object({
	version: z.string().regex(/^\d+\.\d+\.\d+$/),
	experimental: z.literal(false),
	runtime: z.object({
		url: z.url().startsWith("https://registry.npmjs.org/@openai/codex/-/"),
		integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
		unpackedSize: z.number().int().positive(),
	}),
});

/** 配布先とハッシュは生成時に固定し、ユーザー設定から差し替えない。 */
export type CodexRelease = z.infer<typeof releaseSchema>;

/** VSIX に含めた配布情報を読み込んで検証する。実行ファイルは VSIX に含めない。 */
export async function readCodexRelease(
	extensionPath: string,
): Promise<CodexRelease> {
	const content = await readFile(
		join(extensionPath, "dist/runtime/codex/version.json"),
		"utf8",
	);
	return releaseSchema.parse(JSON.parse(content));
}
