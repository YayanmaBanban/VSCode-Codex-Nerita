// OAuth の端末識別子が再起動と同時呼出しをまたいで維持されることを確認する。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { expect, it } from "vitest";
import { getPiDeviceId } from "../../apps/vscode-nerita/src/extension/backends/pi/PiDeviceId";

it("同時呼出しと再読込みで同じ UUID を返し、破損値を勝手に変更しない", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-device-id-"));
	try {
		const ids = await Promise.all([
			getPiDeviceId(root),
			getPiDeviceId(root),
			getPiDeviceId(root),
		]);
		expect(new Set(ids).size).toBe(1);
		expect(ids[0]).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		expect(await getPiDeviceId(root)).toBe(ids[0]);
		await writeFile(join(root, "nerita-device-id"), "corrupt");
		await expect(getPiDeviceId(root)).rejects.toThrow("識別子");
		expect(await readFile(join(root, "nerita-device-id"), "utf8")).toBe(
			"corrupt",
		);
	} finally {
		expect(dirname(root)).toBe(tmpdir());
		expect(basename(root)).toMatch(/^nerita-device-id-/);
		await rm(root, { recursive: true, force: true });
	}
});
