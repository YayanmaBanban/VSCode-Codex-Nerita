// ユーザー共通の Host 保存領域を開き、後続の操作でも保存先の実体を確認する。
import { mkdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { SafeDlcFiles } from "./SafeDlcFiles";

export async function hostFiles(
	storageRoot: string,
	name: "directory-runs" | "session-ownership",
): Promise<SafeDlcFiles> {
	const target = join(storageRoot, name);
	await mkdir(target, { recursive: true });
	const root = await realpath(target);
	const identity = await stat(root);
	/** 保存先の実体と作成時の識別情報を毎回照合し、別の領域への差替えを拒否する。 */
	const assertHostStorageIdentity = async () => {
		const current = await stat(target);
		const matchesValue =
			(await realpath(target)) !== root ||
			current.dev !== identity.dev ||
			current.ino !== identity.ino;
		if (matchesValue) {
			throw new Error("Host の保存先が差し替えられています。");
		}
		if (current.birthtimeMs !== identity.birthtimeMs) {
			throw new Error("Host の保存先が差し替えられています。");
		}
	};
	return new SafeDlcFiles(root, assertHostStorageIdentity);
}
