// 外部ドロップの内容を専用一時領域に保存し、既存の添付入力で検証する。
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
	validDroppedAttachments,
	type DroppedAttachment,
} from "../../shared/attachmentDrop";
import type { Attachment } from "../../shared/composer";
import { readAttachments } from "../session/readAttachments";

let directory: Promise<string> | undefined;
/** URI は実ファイルを確認し、内容転送は同じ名前・内容を同じ参照にする。 */
export async function droppedAttachments(
	files: DroppedAttachment[],
): Promise<Attachment[]> {
	if (!validDroppedAttachments(files)) {
		throw new Error("Invalid dropped attachments");
	}
	const selected: Attachment[] = [];
	for (const file of files) {
		let path: string;
		if ("uri" in file) {
			path = fileURLToPath(file.uri);
		} else {
			const data = Buffer.from(file.data, "base64");
			const digest = createHash("sha256")
				.update(file.name)
				.update(data)
				.digest("hex");
			directory ??= mkdtemp(join(tmpdir(), "nerita-codex-attachments-"));
			const folder = join(await directory, digest);
			await mkdir(folder, { recursive: true });
			path = join(folder, file.name);
			await writeFile(path, data);
		}
		if (!(await stat(path)).isFile()) {
			throw new Error("フォルダーは添付できません。");
		}
		selected.push({
			id: randomUUID(),
			name: basename(path),
			uri: pathToFileURL(path).href,
		});
	}
	// バイナリーや大きすぎるテキストを、一覧へ追加する前に拒否する。
	await readAttachments(selected, true);
	return selected;
}
/** 送信済み画像の参照を保ち、拡張機能の終了時に専用領域だけを削除する。 */
export async function disposeDroppedAttachments(): Promise<void> {
	const current = directory;
	directory = undefined;
	if (current) {
		await rm(await current, { recursive: true, force: true });
	}
}
