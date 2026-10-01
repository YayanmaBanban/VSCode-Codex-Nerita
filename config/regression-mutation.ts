// 製品ファイルを書き換えず、指定した既知回帰だけを読込み時に注入する。
import { writeFileSync } from "node:fs";
import type { Plugin } from "vite";
import cases from "./regression-cases.json";

/** 変換対象の不一致は検出成功にせず、実行基盤の失敗として報告する。 */
export function regressionMutation(): Plugin[] {
	const selected = process.env.NERITA_TEST_MUTATION;
	if (!selected) {
		return [];
	}
	const mutation = cases.find((item) => item.id === selected);
	const marker = process.env.NERITA_TEST_MUTATION_MARKER;
	if (!mutation || !marker) {
		throw new Error("Unknown regression mutation or missing marker");
	}
	return [
		{
			name: "nerita-regression-mutation",
			enforce: "pre",
			transform(source, id) {
				if (!id.replaceAll("\\", "/").endsWith(`/${mutation.file}`)) {
					return;
				}
				let code = source;
				for (const [before, after] of mutation.changes) {
					if (code.split(before).length !== 2) {
						throw new Error(
							`Mutation does not match: ${mutation.id}`,
						);
					}
					code = code.replace(before, after);
				}
				writeFileSync(marker, mutation.id);
				return { code, map: null };
			},
		},
	];
}
