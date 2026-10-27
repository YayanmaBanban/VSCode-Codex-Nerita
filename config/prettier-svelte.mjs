// Svelte のレイアウト用テンプレートを改行し、通常の Prettier と保存時整形で統一する。
// インラインの文章・属性・空白保持要素は上流プラグインの扱いを維持する。
import svelte from "prettier-plugin-svelte";
import * as tailwind from "prettier-plugin-tailwindcss";

const blockElements = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"body",
	"button",
	"caption",
	"dd",
	"details",
	"dialog",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hgroup",
	"hr",
	"html",
	"legend",
	"li",
	"main",
	"menu",
	"nav",
	"ol",
	"p",
	"section",
	"summary",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);
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

// 空白を挟むと文言やインライン要素の間隔が変わる断片を除く。
function isLayoutFragment(fragment) {
	return fragment.nodes.every((node) => {
		if (node.type === "Text") {
			return /^[\t\n\f\r ]*$/.test(node.data);
		}
		return node.type !== "ExpressionTag" && node.type !== "HtmlTag";
	});
}

// 新しい空白の位置を隣接ノードの境界に合わせ、元のタグ・式の範囲を保つ。
function lineAt(position) {
	return {
		type: "Text",
		start: position,
		end: position,
		raw: "\n",
		data: "\n",
	};
}

// 既存の空行は残し、空白のない構造上の境界にだけ改行を補う。
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

// 明示的なインライン要素に入ったら、内部の条件分岐もインラインのまま扱う。
function childLayout(node, layout) {
	if (node.type === "RegularElement") {
		// button はインラインの並びにも使うため、単一の子要素だけを改行する。
		// 複数の子要素間へ空白を足すと、表示や textContent が変わってしまう。
		if (node.name === "button") {
			const children = node.fragment.nodes.filter(
				(child) => child.type !== "Text",
			);
			const singleElement =
				children.length === 1 &&
				["Component", "RegularElement"].includes(children[0].type);
			if (!singleElement) {
				return false;
			}
		}
		return blockElements.has(node.name);
	}
	return layout;
}

// 属性や JavaScript の AST は巡回せず、テンプレートの断片だけを処理する。
function visitNode(node, layout) {
	if (["pre", "textarea", "script", "style"].includes(node.name)) {
		return;
	}
	for (const key of fragments) {
		const fragment = node[key];
		if (fragment?.type === "Fragment") {
			visitFragment(fragment, childLayout(node, layout));
		}
	}
}

// prettier-ignore の直後は子孫も変更せず、上流の無視指定を尊重する。
function visitFragment(fragment, layout) {
	if (
		fragment.nodes.some(
			(node) =>
				node.type === "Comment" &&
				node.data.trim().startsWith("prettier-ignore"),
		)
	) {
		return;
	}
	const separate = layout && isLayoutFragment(fragment);
	for (const node of fragment.nodes) {
		if (node.type === "Text") {
			continue;
		}
		visitNode(node, separate);
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
	// Tailwind 側の printer は遅延ロードされるため、解決後に改行処理を重ねる。
	"svelte-ast": async () => {
		let printer = tailwind.printers["svelte-ast"];
		if (typeof printer === "function") {
			printer = await printer();
		}
		return {
			...printer,
			print(path, options, print) {
				// 上流の embed による script/style のコメント移動を終えてから補う。
				if (path.node.type === "Root") {
					visitFragment(path.node.fragment, true);
				}
				return printer.print(path, options, print);
			},
		};
	},
};
