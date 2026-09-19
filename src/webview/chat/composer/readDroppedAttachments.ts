// ドロップ内容を検証し、ローカルURIを優先して添付要求のデータへ変換する。
import {
	MAX_DROP_BYTES,
	isLocalFileUri,
	type DroppedAttachment,
} from "../../../shared/attachmentDrop";

/** ファイル内容をJSONで送れるBase64へ変換する。 */
function readFile(file: File): Promise<DroppedAttachment> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(new Error("ファイルを読み込めませんでした。"));
		reader.onload = () =>
			resolve({
				name: file.name,
				data: (reader.result as string).split(",")[1] ?? "",
			});
		reader.readAsDataURL(file);
	});
}

/** DataTransferはイベント中に読み取り、URIがなければファイル内容を非同期で取得する。 */
export async function readDroppedAttachments(
	transfer: DataTransfer,
): Promise<DroppedAttachment[]> {
	if (
		Array.from(transfer.items).some(
			(item) => item.webkitGetAsEntry?.()?.isDirectory,
		)
	) {
		throw new Error("フォルダーは添付できません。");
	}

	let uris = transfer
		.getData("text/uri-list")
		.split(/\r?\n/)
		.map((uri) => uri.trim())
		.filter(isLocalFileUri);
	// VS Codeのエクスプローラーが渡すローカル絶対パスも参照として扱う。
	const codeFiles = transfer.getData("CodeFiles");
	if (!uris.length && codeFiles) {
		const paths: unknown = JSON.parse(codeFiles);
		if (Array.isArray(paths)) {
			uris = paths
				.filter((path): path is string => typeof path === "string")
				.filter((path) => /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path))
				.map((path) => {
					const normalized = path.replaceAll("\\", "/");
					return `file:${normalized.startsWith("//") ? "" : normalized.startsWith("/") ? "//" : "///"}${normalized
						.split("/")
						.map(encodeURIComponent)
						.join("/")
						.replace(/^([a-z])%3A/i, "$1:")}`;
				})
				.filter(isLocalFileUri);
		}
	}

	const files = Array.from(transfer.files);
	if (
		Math.max(uris.length, files.length) > 20 ||
		files.reduce((sum, file) => sum + file.size, 0) > MAX_DROP_BYTES
	) {
		throw new Error(
			"一度に添付できるのは20ファイル、内容の転送は合計20MBまでです。",
		);
	}

	const dropped = uris.length
		? uris.map((uri) => ({ uri }))
		: await Promise.all(files.map(readFile));
	if (!dropped.length) {
		throw new Error("ローカルファイルをドロップしてください。");
	}

	return dropped;
}
