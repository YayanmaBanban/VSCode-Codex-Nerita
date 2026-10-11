// 書込み Run の予約を Host の保存領域で共有し、別ウィンドウとの競合も検出する。
import { isAbsolute } from "node:path";
import { z } from "zod";
import { DirectoryRuns } from "../session/DirectoryRuns";
import { hostFiles } from "./HostFiles";
import { withDlcLock } from "./DlcLock";

const recordsSchema = z.array(
	z.strictObject({
		token: z.uuid(),
		root: z.string().refine(isAbsolute),
		pid: z.number().int().positive(),
	}),
);

/** 保存の短い区間だけを直列化し、モデルやコマンドの実行中はロックを保持しない。 */
export async function directoryRunStorage(
	storageRoot: string,
): Promise<DirectoryRuns> {
	const files = await hostFiles(storageRoot, "directory-runs");
	let queue: Promise<void> = Promise.resolve();
	return new DirectoryRuns({
		update: (operation) => {
			const pending = queue.then(() =>
				withDlcLock(files, async () => {
					const text = await files.read(".nerita/dlc/runs.json");
					const records =
						text === undefined
							? []
							: recordsSchema.parse(JSON.parse(text));
					await files.write(
						".nerita/dlc/runs.json",
						recordsSchema.parse(operation(records)),
					);
				}),
			);
			queue = pending.catch(() => {});
			return pending;
		},
	});
}
