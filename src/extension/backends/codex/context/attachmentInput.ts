// 検証済み添付を App Server の画像・テキスト入力へ変換する。
import type { Attachment } from "../../../../shared/composer";
import type { UserInput } from "../codex-app-server/v2/UserInput";
import { readAttachments } from "../../../session/readAttachments";

/** 読み込み制限を共通処理に任せ、Codex 固有の入力形式だけを組み立てる。 */
export async function attachmentInput(
	files: Attachment[],
	images: boolean,
): Promise<UserInput[]> {
	return (await readAttachments(files, images)).map((file) =>
		file.type === "image"
			? { type: "localImage", path: file.path }
			: {
					type: "text",
					text: `添付ファイル: ${file.path}\n${file.text}`,
					text_elements: [],
				},
	);
}
