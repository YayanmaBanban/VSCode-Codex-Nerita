// Markdown の構造を保ちながら、検証済みの参照位置だけをチップへ置換する。
import {
	pathText,
	validReferences,
	type ComposerReference,
} from "../../../shared/composerReferences";
import type { ComposerTarget } from "../../../shared/composerTargets";

/** テキストと子要素だけを辿る、変換用の HTML 構文木。 */
type HtmlNode = {
	type: string;
	value?: string;
	children?: HtmlNode[];
	tagName?: string;
	properties?: Record<string, string>;
};

/** 元の本文に存在しない識別子を選び、コード内でもチップを復元する。 */
export function messageReferences(
	text: string,
	references: ComposerReference[],
) {
	const targets = new Map<string, ComposerTarget>();
	let prefix = "CODEXREFERENCE";
	while (text.includes(prefix)) {
		prefix += "REF";
	}
	const pattern = new RegExp(`(${prefix}[0-9]+END)`, "g");
	/** テキストだけを置換し、生の HTML や外部 URL を生成しない。 */
	const plugin = () => (tree: HtmlNode) => {
		const visit = (node: HtmlNode): void => {
			// リンク先や画像の代替文ではチップを挿入せず、元の参照文字列を保つ。
			const restore = (value: string) =>
				value.replace(pattern, (token) => {
					const target = targets.get(token);
					return target ? pathText(target) : token;
				});
			for (const [key, value] of Object.entries(node.properties ?? {})) {
				if (typeof value === "string") {
					node.properties![key] = restore(value);
				}
			}
			if (node.type !== "text" && node.value) {
				node.value = restore(node.value);
			}
			if (!node.children) {
				return;
			}
			node.children = node.children.flatMap((child): HtmlNode[] => {
				if (child.type !== "text" || !child.value) {
					visit(child);
					return [child];
				}
				return child.value.split(pattern).map((value) =>
					targets.has(value)
						? {
								type: "element",
								tagName: "span",
								properties: { title: value },
								children: [],
							}
						: { type: "text", value },
				);
			});
		};
		visit(tree);
	};
	if (!references.length || !validReferences(text, references)) {
		return { text, targets, plugin };
	}
	let cursor = 0;
	let result = "";
	for (const [index, reference] of references.entries()) {
		const href = `${prefix}${index}END`;
		targets.set(href, reference.path);
		result += `${text.slice(cursor, reference.offset)}${href}`;
		cursor = reference.offset + pathText(reference.path).length;
	}
	return { text: result + text.slice(cursor), targets, plugin };
}
