// Markdown の構造から仕様書の整理候補を検出し、既存の一文の長さ検査を再利用する。
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLinter, loadTextlintrc } from "textlint";
import { maskProtectedText } from "./textlint-protected.mjs";

const configFile = fileURLToPath(
	new URL("../config/.textlintrc.json", import.meta.url),
);
const modulesDir = fileURLToPath(new URL("../node_modules", import.meta.url));
const protectedTypes = new Set([
	"Code",
	"InlineCode",
	"Html",
	"Comment",
	"Image",
	"ImageReference",
	"Definition",
	"LinkReferenceDefinition",
]);

/** URL やパスと、文章ではない複合形式の識別子を文字数から除く。 */
function prose(text) {
	return maskProtectedText(text).replace(
		/\b(?:[a-z]+(?:[A-Z][a-z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\b/g,
		(value) => " ".repeat(value.length),
	);
}

/** 子リストを親項目へ加算せず、強調やリンクの表示名は本文として読む。 */
function nodeText(node) {
	if (protectedTypes.has(node.type) || node.type === "List") {
		return "";
	}
	if (node.type === "Str") {
		return prose(node.value ?? "");
	}
	return (node.children ?? []).map(nodeText).join(" ");
}

/** 構文を除いた本文の文字数を Unicode コードポイント単位で数える。 */
function textLength(node) {
	return [...nodeText(node).replace(/\s/gu, "")].length;
}

/** 元の位置を保つ複製を作り、既存ルールにコードや識別子を数えさせない。 */
function sentenceNode(node) {
	if (protectedTypes.has(node.type)) {
		const raw = node.raw.replace(/[^\r\n]/g, " ");
		return {
			...node,
			parent: node.parent,
			value: raw,
			raw,
			children: undefined,
		};
	}
	if (node.type === "Str") {
		return {
			...node,
			parent: node.parent,
			value: prose(node.value ?? ""),
			raw: prose(node.raw ?? node.value ?? ""),
		};
	}
	const children = node.children?.map(sentenceNode);
	let raw = node.raw;
	for (const child of children ?? []) {
		const start = child.range[0] - node.range[0];
		raw =
			raw.slice(0, start) +
			child.raw +
			raw.slice(start + child.raw.length);
	}
	// 表示名だけの段落も検査するため、既存ルールの単独リンク除外を適用しない。
	return {
		...node,
		parent: node.parent,
		type: node.type === "Link" ? "Emphasis" : node.type,
		raw,
		children,
	};
}

/** 既存ルールの分割結果を元の段落へ対応させ、先行行の長さによる列番号のずれを防ぐ。 */
function sentenceRule(rule, maximum) {
	return (context) => ({
		Paragraph(node) {
			const scoped = Object.create(context, {
				report: {
					value: (sentence, error) =>
						context.report(
							node,
							new context.RuleError(error.message, {
								padding: context.locator.range([
									sentence.range[0] - node.range[0],
									sentence.range[1] - node.range[0],
								]),
							}),
						),
				},
			});
			const delegate = rule(scoped, {
				max: maximum,
				countBy: "codepoints",
				skipPatterns: ["/\\s+/gu"],
			});
			delegate.Paragraph(sentenceNode(node));
		},
	});
}

/** 段落とリスト項目を別々に検査し、入れ子の同じ本文を重複報告しない。 */
function lengthRule(kind, maximum) {
	return (context) => ({
		[kind](node) {
			if (kind === "Paragraph") {
				for (let parent = node.parent; parent; parent = parent.parent) {
					if (parent.type === "ListItem") {
						return;
					}
				}
			}
			const length = textLength(node);
			if (length > maximum) {
				context.report(
					node,
					new context.RuleError(
						`${kind === "Paragraph" ? "段落" : "箇条書きの項目"}の本文が${length}文字あります（目安: ${maximum}文字）。内容のまとまりを確認して分割を検討してください。`,
					),
				);
			}
		},
	});
}

/** 条件に続く結果がある表現だけを候補とし、変換の可否は構成レビューへ渡す。 */
function conditionCount(node) {
	return [
		...nodeText(node).matchAll(
			/(?:場合(?:には|[はに、])|とき(?:には|[はに、])|ならば?[、,])\s*[^。\n]+/gu,
		),
	].length;
}

/** 同じリスト内または隣接段落で条件と結果が繰り返される箇所を示す。 */
function tableRule(minimum) {
	return (context) => {
		const report = (node, count) =>
			context.report(
				node,
				new context.RuleError(
					`条件と結果が${count}件続いています。条件・処理・例外を表に整理できるか確認してください。自動変換は行いません。`,
				),
			);
		return {
			Paragraph(node) {
				const count = conditionCount(node);
				if (count >= minimum) {
					report(node, count);
				}
			},
			"Document:exit"(node) {
				/** 階層ごとに連続する項目だけを数え、離れた節や子リストを合算しない。 */
				const visit = (parent) => {
					if (parent.type === "Document" || parent.type === "List") {
						let group = [];
						const flush = () => {
							if (group.length >= minimum) {
								report(group[0], group.length);
							}
							group = [];
						};
						for (const child of parent.children ?? []) {
							const eligible =
								child.type === "Paragraph" ||
								child.type === "ListItem";
							if (eligible && conditionCount(child) === 1) {
								group.push(child);
							} else {
								flush();
							}
						}
						flush();
					}
					for (const child of parent.children ?? []) {
						visit(child);
					}
				};
				visit(node);
			},
		};
	};
}

/** 不正な閾値や設定名を検査前に拒否する。 */
function settings(config, overrides) {
	const defaults = {
		sentenceMax: 100,
		paragraphMax: 200,
		listItemMax: 160,
		tableMin: 3,
	};
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		throw new Error("spec settings must be an object");
	}
	const result = { ...defaults, ...config, ...overrides };
	for (const [key, value] of Object.entries(result)) {
		const minimum = key === "tableMin" ? 2 : 1;
		if (
			!Object.hasOwn(defaults, key) ||
			!Number.isSafeInteger(value) ||
			value < minimum
		) {
			throw new Error(`Invalid spec setting: ${key}`);
		}
	}
	return result;
}

/** 通常のプリセットを変更せず、仕様書専用の警告だけを出す検査器を作る。 */
export async function createSpecLinter(overrides = {}) {
	const config = JSON.parse(await fs.readFile(configFile, "utf8"));
	const options = settings(config.spec ?? {}, overrides);
	const base = await loadTextlintrc({
		configFilePath: configFile,
		node_modulesDir: modulesDir,
	});
	const sentence = base
		.toKernelOptions()
		.rules.find((rule) => rule.ruleId.endsWith("/sentence-length"));
	if (!sentence) {
		throw new Error(
			"The technical-writing sentence-length rule is required",
		);
	}
	const descriptor = base.shallowMerge({
		rules: [
			{
				ruleId: "spec/long-sentence",
				rule: sentenceRule(sentence.rule, options.sentenceMax),
				options: { severity: "warning" },
			},
			{
				ruleId: "spec/long-paragraph",
				rule: lengthRule("Paragraph", options.paragraphMax),
				options: { severity: "warning" },
			},
			{
				ruleId: "spec/long-list-item",
				rule: lengthRule("ListItem", options.listItemMax),
				options: { severity: "warning" },
			},
			{
				ruleId: "spec/table-candidate",
				rule: tableRule(options.tableMin),
				options: { severity: "warning" },
			},
		],
	});
	return createLinter({ descriptor });
}
