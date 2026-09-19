// ドロップしたローカル参照とファイル内容の通信制限を共有する。
export const MAX_DROP_BYTES = 20 * 1024 * 1024;

/** パスを取得できないブラウザーのFileは内容として転送する。 */
export type DroppedAttachment =
	{ uri: string } | { name: string; data: string };

/** ローカルファイルURIだけを許可する。 */
export function isLocalFileUri(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 8192) {
		return false;
	}

	try {
		const uri = new URL(value);
		return uri.protocol === "file:" && !uri.search && !uri.hash;
	} catch {
		return false;
	}
}

/** 件数・名前・Base64形式と合計転送量を通信境界で制限する。 */
export function validDroppedAttachments(
	value: unknown,
): value is DroppedAttachment[] {
	if (!Array.isArray(value) || !value.length || value.length > 20) {
		return false;
	}

	let total = 0;
	return value.every((item: unknown) => {
		if (!item || typeof item !== "object") {
			return false;
		}
		if ("uri" in item) {
			return isLocalFileUri(item.uri);
		}
		if (
			!("name" in item) ||
			typeof item.name !== "string" ||
			!item.name ||
			item.name.length > 255 ||
			/[<>:"/\\|?*]/.test(item.name) ||
			Array.from(item.name).some((char) => char.charCodeAt(0) < 32) ||
			/[. ]$/.test(item.name) ||
			/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item.name) ||
			!("data" in item) ||
			typeof item.data !== "string"
		) {
			return false;
		}

		total += item.data.length;
		return (
			total <= Math.ceil(MAX_DROP_BYTES / 3) * 4 &&
			item.data.length % 4 === 0 &&
			/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)
		);
	});
}
