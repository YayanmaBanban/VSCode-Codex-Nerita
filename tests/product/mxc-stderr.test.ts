// SDK の診断ポインターが分割・連結されてもツールの stderr を変えないことを確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { MxcStderr } from "../../apps/vscode-nerita/src/extension/runtime/MxcStderr";

void test("改行なしの stderr と分割された MXC 診断情報を分離する", () => {
	const directory = join(process.cwd(), "host-report");
	const pointer = `${JSON.stringify({ type: "captureDenials", outputPath: join(directory, "denials.123_test.json") })}\n`;
	const chunks: string[] = [];
	const filter = new MxcStderr(directory, (chunk) => chunks.push(chunk));
	for (const character of `tool stderr${pointer}`) {
		filter.write(character);
	}
	filter.end();
	assert.equal(chunks.join(""), "tool stderr");
});

void test("任意の JSON や不正なポインターをツール出力から削除しない", () => {
	const chunks: string[] = [];
	const filter = new MxcStderr(join(process.cwd(), "host-report"), (chunk) =>
		chunks.push(chunk),
	);
	const output = `${JSON.stringify({ type: "captureDenials", outputPath: join(process.cwd(), "outside.json") })}\n{"type":"captureDenials",invalid}\nlast line`;
	filter.write(output);
	filter.end();
	assert.equal(chunks.join(""), output);
});
