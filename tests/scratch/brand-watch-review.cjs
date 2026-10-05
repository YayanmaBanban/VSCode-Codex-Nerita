// Extension Host の watch 起動後に実行し、ブランド資産だけの変更と復元が配布先に反映されることを確認する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout } = require("node:timers/promises");

/** 3資産を個別に更新し、元のバイト列へ戻すまでを検証する。 */
async function main() {
	for (const name of [
		"nerita_store_icon.png",
		"nerita.svg",
		"nerita-24.svg",
	]) {
		const source = path.resolve("apps/nerita-ui/media", name);
		const target = path.resolve("apps/vscode-nerita/dist/media", name);
		const original = await fs.readFile(source);
		const updated = Buffer.concat([
			original,
			Buffer.from("\n<!-- watch review -->"),
		]);
		try {
			await fs.writeFile(source, updated);
			await propagated(target, updated);
		} finally {
			await fs.writeFile(source, original);
			await propagated(target, original);
		}
		assert.deepEqual(await fs.readFile(source), original);
		console.log(`ブランド単独 watch: ${name}（変更・復元とも伝播）`);
	}
}

/** ファイル監視の非同期コピーを待ち、期限内に同じバイト列へ更新されなければ失敗する。 */
async function propagated(target, expected) {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if ((await fs.readFile(target)).equals(expected)) {
			return;
		}
		await setTimeout(25);
	}
	assert.fail(`watch のコピーが完了しません: ${path.basename(target)}`);
}
void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
