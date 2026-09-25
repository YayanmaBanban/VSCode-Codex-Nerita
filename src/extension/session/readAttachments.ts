// ローカル添付のサイズ・文字コードを検証し、バックエンドに依存しない入力へ読み込む。
import { fileURLToPath } from "node:url";
import { extname } from "node:path";
import { open } from "node:fs/promises";
import type { Attachment } from "../../shared/composer";

/** バックエンド別のプロトコル変換前の添付内容。 */
export type AttachmentContent =
	| { type: "image"; path: string }
	| { type: "text"; path: string; text: string };

/** テキストは合計 2 MiB まで読み込み、画像はローカル参照を渡す。 */
export async function readAttachments(
	files: Attachment[],
	images: boolean,
): Promise<AttachmentContent[]> {
	const input: AttachmentContent[] = [];
	let remaining = 2 * 1024 * 1024;
	for (const file of files) {
		const path = fileURLToPath(file.uri);
		if (/^\.(png|jpe?g|webp|gif)$/i.test(extname(path))) {
			if (!images) {
				throw new Error("Image input unavailable");
			}
			input.push({ type: "image", path });
			continue;
		}
		const handle = await open(path, "r");
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size > remaining) {
				throw new Error("Attachment too large");
			}
			const buffer = Buffer.alloc(stat.size + 1);
			const { bytesRead } = await handle.read(
				buffer,
				0,
				buffer.length,
				0,
			);
			if (bytesRead > stat.size) {
				throw new Error("Attachment changed");
			}
			remaining -= bytesRead;
			const text = new TextDecoder("utf-8", { fatal: true }).decode(
				buffer.subarray(0, bytesRead),
			);
			if (text.includes("\0")) {
				throw new Error("Binary attachment");
			}
			input.push({
				type: "text",
				path,
				text,
			});
		} finally {
			await handle.close();
		}
	}
	return input;
}
