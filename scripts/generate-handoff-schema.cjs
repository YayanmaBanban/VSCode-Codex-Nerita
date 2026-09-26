// 共通の検証定義から、拡張機能に同梱する JSON スキーマを生成する。
const { build } = require("esbuild");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 一時バンドルを dist に置き、スキーマの二重管理を避ける。 */
async function main() {
	await mkdir("dist/handoff-schema", { recursive: true });
	const output = join(process.cwd(), "dist/handoff-schema/config.cjs");
	await build({
		entryPoints: ["src/shared/agentManager/config.ts"],
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile: output,
		external: ["zod"],
	});
	const { handoffSchema } = require(output);
	const { z } = require("zod");
	await writeFile(
		"src/shared/agentManager/handoff.schema.json",
		`${JSON.stringify(z.toJSONSchema(handoffSchema), null, 2)}\n`,
	);
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
