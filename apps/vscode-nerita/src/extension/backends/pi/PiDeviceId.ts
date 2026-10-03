// ChatGPT OAuth に渡すインストール識別子を、認証情報とは別に保存する。
import { randomUUID } from "node:crypto";
import {
	link,
	lstat,
	mkdir,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

/** 同時ログインでも最初に保存された UUID を使い、破損した識別子は書き換えない。 */
export async function getPiDeviceId(agentDir: string): Promise<string> {
	const file = join(agentDir, "nerita-device-id");
	await mkdir(agentDir, { recursive: true });
	const temporary = join(agentDir, `nerita-device-id-${randomUUID()}.tmp`);
	await writeFile(temporary, randomUUID(), { flag: "wx", mode: 0o600 });
	try {
		// 書込み済みの一時ファイルから保存先へのリンクを作り、別の Host が書込み途中のファイルを読むのを防ぐ。
		await link(temporary, file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
	} finally {
		await unlink(temporary);
	}
	const stat = await lstat(file);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64) {
		throw new Error("Pi のインストール識別子を読み込めません。");
	}
	const value = (await readFile(file, "utf8")).trim();
	if (
		!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
			value,
		)
	) {
		throw new Error("Pi のインストール識別子を読み込めません。");
	}
	return value;
}
