// 認証値は実行前のメモリー内の伏字処理にだけ使い、ログや設定へ出力しない。
import { open } from "node:fs/promises";
import { join } from "node:path";

/** 登録済みの認証値と環境変数の秘密値を、上限のある読込みで集める。 */
export async function piFeatureSecrets(
	agentDir: string,
): Promise<readonly string[]> {
	const secrets = Object.entries(process.env)
		.filter(
			([key, value]) =>
				/TOKEN|SECRET|PASSWORD|API_KEY/.test(key) && !!value,
		)
		.map(([, value]) => value!);
	for (const name of ["auth.json", "mcp-auth.json"]) {
		await readSecrets(join(agentDir, name), secrets);
	}
	return secrets;
}

/** OAuth の保存先ごとに読込み量を制限し、構文エラーの認証値を出さない。 */
async function readSecrets(path: string, secrets: string[]): Promise<void> {
	try {
		const file = await open(path, "r");
		try {
			if ((await file.stat()).size > 65536) {
				throw new Error("認証ファイルのサイズが上限を超えています。");
			}
			const buffer = Buffer.alloc(65537);
			const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
			if (bytesRead > 65536) {
				throw new Error("認証ファイルのサイズが上限を超えています。");
			}
			JSON.parse(
				buffer.subarray(0, bytesRead).toString("utf8"),
				(key: string, value: unknown) => {
					if (
						/access|refresh|key|token|secret/i.test(key) &&
						typeof value === "string" &&
						value
					) {
						secrets.push(value);
					}
					return value;
				},
			);
		} finally {
			await file.close();
		}
	} catch (error) {
		if (!(
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)) {
			// JSON の構文エラーに含まれる可能性のある認証文字列を除去する。
			if (error instanceof Error) {
				error.message = "認証読込み失敗";
				error.stack = error.name;
			}
			throw new Error("認証値の保護を準備できませんでした。", {
				cause: error,
			});
		}
	}
}
