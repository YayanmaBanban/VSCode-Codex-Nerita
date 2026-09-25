// 実行時の Zod 定義から、配布と JSON 編集用のスキーマを生成する。
const { build } = require("esbuild");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

/** 一時バンドルは dist に限定し、スキーマを手作業で二重管理しない。 */
async function main() {
	await mkdir("dist/guardrails-schema", { recursive: true });
	const output = join(process.cwd(), "dist/guardrails-schema/config.cjs");
	await build({
		entryPoints: ["src/shared/guardrails/config.ts"],
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile: output,
		external: ["zod"],
	});
	const { guardrailsConfigSchema } = require(output);
	const { z } = require("zod");
	await writeFile(
		"src/extension/backends/pi/guardrails/schema.json",
		`${JSON.stringify(z.toJSONSchema(guardrailsConfigSchema), null, 2)}\n`,
	);
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
