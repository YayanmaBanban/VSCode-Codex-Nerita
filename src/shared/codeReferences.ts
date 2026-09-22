// コード参照は本文を保存せず、送信時に読むURIと範囲を保持する。
import { isSourceRange, type SourceRange } from "./symbolLocation";
import { isPathString } from "./workspacePaths";

/** 送信時に本文を取得するローカルファイルの座標。 */
export type CodeReference = { uri: string; range: SourceRange };

/** UIから渡される参照の件数・URI・座標を検証する。 */
export function validCodeReferences(
	value: unknown,
): value is CodeReference[] | undefined {
	return (
		value === undefined ||
		(Array.isArray(value) &&
			value.length <= 20 &&
			value.every((item: unknown) => {
				if (!item || typeof item !== "object") {
					return false;
				}
				const reference = item as Record<string, unknown>;
				return (
					isPathString(reference.uri) &&
					reference.uri.startsWith("file://") &&
					isSourceRange(reference.range)
				);
			}))
	);
}
