// Git 差分の対象範囲を固定し、チップと Host 要求で同じ識別子を使う。
export const changeScopes = {
	uncommitted: {
		name: "Uncommitted",
		description: "未ステージの変更（未追跡ファイルを除く）",
	},
	staged: { name: "Staged", description: "ステージ済みの変更" },
	"since-last-commit": {
		name: "Since last commit",
		description:
			"最新コミット以降の変更（ステージ済み＋未ステージ、未追跡を除く）",
	},
	branch: {
		name: "Current branch vs main",
		description: "mainとの分岐点から現在のブランチまでの変更",
	},
} as const;

/** ユーザーが選べる差分の範囲。 */
export type ChangeScope = keyof typeof changeScopes;

/** 差分そのものは保存せず、送信時に最新内容を読み込む参照。 */
export type ChangeReference = {
	kind: "changes";
	scope: ChangeScope;
	name: string;
};

/** コマンド引数には既知の範囲だけを許可する。 */
export function isChangeScope(value: unknown): value is ChangeScope {
	return typeof value === "string" && Object.hasOwn(changeScopes, value);
}

/** 保存データやクリップボード由来のチップを検証する。 */
export function isChangeReference(value: unknown): value is ChangeReference {
	if (!value || typeof value !== "object") {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		entry.kind === "changes" &&
		isChangeScope(entry.scope) &&
		entry.name === changeScopes[entry.scope].name
	);
}

/** 送信範囲の数と値を Host 境界で検証する。 */
export function validChangeScopes(
	value: unknown,
): value is ChangeScope[] | undefined {
	return (
		value === undefined ||
		(Array.isArray(value) &&
			value.length <= 4 &&
			value.every(isChangeScope))
	);
}
