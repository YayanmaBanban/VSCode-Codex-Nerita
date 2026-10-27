// Svelte テンプレートに改行を補い、CLI と保存時の整形結果を揃える。
// タグ内の改行は標準設定に任せ、文言や要素間の空白が変わる箇所を保護する。
import svelte from "prettier-plugin-svelte";
import * as tailwind from "prettier-plugin-tailwindcss";

const fragments = [
	"fragment",
	"body",
	"consequent",
	"alternate",
	"fallback",
	"pending",
	"then",
	"catch",
];

// 空白以外の本文・式・HTML 挿入を含む断片を、改行の追加対象から除く。
function isLayoutFragment(fragment) {
	return fragment.nodes.every((node) => {
		if (node.type === "Text") {
			return /^[\t\n\f\r ]*$/.test(node.data);
		}
		return node.type !== "ExpressionTag" && node.type !== "HtmlTag";
	});
}

// 挿入する改行をソース上の長さ0として扱い、元のタグ・式の位置を維持する。
function lineAt(position) {
	return {
		type: "Text",
		start: position,
		end: position,
		raw: "\n",
		data: "\n",
	};
}

// 既存の改行を残し、改行のない空白を改行に置き換える。空白なしで隣接するノードや断片の前後にも改行を補う。
function separateNodes(fragment) {
	const nodes = [];
	for (const node of fragment.nodes) {
		if (node.type === "Text") {
			node.raw = node.raw.includes("\n") ? node.raw : "\n";
			node.data = node.raw;
		} else if (nodes.at(-1)?.type !== "Text") {
			nodes.push(lineAt(node.start));
		}
		nodes.push(node);
	}
	const last = nodes.at(-1);
	if (last && last.type !== "Text") {
		nodes.push(lineAt(last.end));
	}
	fragment.nodes = nodes;
}

// 本文や式が他のノードと並ぶ場合や、要素が空白なしで隣接する場合は、`css` の空白判定で保護する。
function needsWhitespaceProtection(fragment) {
	const content = fragment.nodes.filter(
		(node) => node.type !== "Text" || !/^[\t\n\f\r ]*$/.test(node.data),
	);
	if (content.length < 2) {
		return false;
	}
	if (
		content.some((node) =>
			["Text", "ExpressionTag", "HtmlTag"].includes(node.type),
		)
	) {
		return true;
	}
	return fragment.nodes.some((node, index, nodes) => {
		const previous = nodes[index - 1];
		if (!previous || previous.type === "Text" || node.type === "Text") {
			return false;
		}
		return [node, previous].some((child) =>
			[
				"RegularElement",
				"Component",
				"ExpressionTag",
				"HtmlTag",
			].includes(child.type),
		);
	});
}

// `else if` は `alternate` 内の単一の `IfBlock` で表される。入れ子の分岐として出力されるのを避けるため、前後へ `Text` を追加しない。
function isElseIfFragment(fragment, owner) {
	if (owner.type !== "IfBlock" || owner.alternate !== fragment) {
		return false;
	}
	if (fragment.nodes.length !== 1) {
		return false;
	}
	const child = fragment.nodes[0];
	return child.type === "IfBlock" && child.elseif;
}

// 属性や JavaScript の AST は巡回せず、テンプレートの断片だけを処理する。
function visitNode(node, layout, protectedNodes) {
	// `option` で `value` を省略した場合の値を保つため、本文の空白を保護する。
	if (node.name === "option") {
		protectedNodes.add(node);
	}
	if (["pre", "textarea", "script", "style"].includes(node.name)) {
		return;
	}
	for (const key of fragments) {
		const fragment = node[key];
		if (fragment?.type === "Fragment") {
			visitFragment(fragment, layout, node, protectedNodes);
		}
	}
}

// `prettier-ignore` を含む断片では子孫も加工せず、独自の改行処理で無視対象を変えない。
function visitFragment(fragment, layout, owner, protectedNodes) {
	if (
		fragment.nodes.some(
			(node) =>
				node.type === "Comment" &&
				node.data.trim().startsWith("prettier-ignore"),
		)
	) {
		return;
	}
	const protectedWhitespace = needsWhitespaceProtection(fragment);
	if (protectedWhitespace) {
		protectedNodes.add(owner);
		protectedNodes.add(fragment);
		for (const node of fragment.nodes) {
			protectedNodes.add(node);
		}
	}
	const layoutAllowed = layout && !protectedWhitespace;
	const separate =
		layoutAllowed &&
		!isElseIfFragment(fragment, owner) &&
		isLayoutFragment(fragment);
	for (const node of fragment.nodes) {
		if (node.type === "Text") {
			continue;
		}
		visitNode(node, separate, protectedNodes);
	}
	if (separate) {
		separateNodes(fragment);
	}
}

export const languages = svelte.languages;
export const options = { ...svelte.options, ...tailwind.options };
export const parsers = { ...svelte.parsers, ...tailwind.parsers };
export const printers = {
	...svelte.printers,
	...tailwind.printers,
	// Tailwind CSS の `printer` は遅延ロードされるため、取得後に独自の改行処理を組み込む。
	"svelte-ast": async () => {
		const protectedNodes = new WeakSet();
		let printer = tailwind.printers["svelte-ast"];
		if (typeof printer === "function") {
			printer = await printer();
		}
		return {
			...printer,
			print(path, options, print) {
				// 上流の `embed` による `script` / `style` のコメント移動後に、改行を補う。
				if (path.node.type === "Root") {
					visitFragment(
						path.node.fragment,
						true,
						path.node,
						protectedNodes,
					);
				}
				const printOptions =
					options.htmlWhitespaceSensitivity === "ignore" &&
					protectedNodes.has(path.node)
						? { ...options, htmlWhitespaceSensitivity: "css" }
						: options;
				return printer.print(path, printOptions, print);
			},
		};
	},
};
