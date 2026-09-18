// 入力中のトリガーと候補を、メニュー表示から分離する。
import {
	$getSelection,
	$isRangeSelection,
	$getNodeByKey,
	$isElementNode,
	$createTextNode,
	$addUpdateTag,
	HISTORY_PUSH_TAG,
} from "lexical";
import type { Attachment } from "../../../shared/composer";
import type { SkillSummary } from "../../../shared/skills";
import type { WorkspacePath } from "../../../shared/workspacePaths";
import type { ComposerTarget } from "../../../shared/composerTargets";
import type { SessionReference } from "../../../shared/sessionReferences";
import { symbolKindName } from "../../../shared/workspaceSymbols";
import { pathText } from "../../../shared/composerReferences";
import {
	changeScopes,
	type ChangeScope,
	type ChangeReference,
} from "../../../shared/changeReferences";
import { $pointOffset, $selectOffset } from "./content";
import { PastedBlockNode } from "./PastedBlockNode";
import { $createPathReferenceNode } from "./PathReferenceNode";

/** トリガー文字を含む置換範囲と候補検索の状態。 */
export type Completion = {
	key: string;
	start: number;
	end: number;
	marker: string;
	query: string;
};
/** 選択可能な候補。categoryは次の一覧を開く入口。 */
export type CompletionItem = {
	id: string;
	label: string;
	description?: string;
	text?: string;
	category?: string;
	directory?: WorkspacePath;
	reference?: ComposerTarget;
	more?: boolean;
};

/** サーバーの並びを維持してセッション候補を参照チップに変換する。 */
export function sessionCompletionItems(
	entries: SessionReference[],
): CompletionItem[] {
	return entries.map((entry) => ({
		id: entry.sessionId,
		label: entry.name,
		description: `${entry.cwd} · ${entry.sessionId}`,
		text: `${pathText(entry)} `,
		reference: entry,
	}));
}

/** シンボル名と定義位置を候補・チップ挿入用データへ変換する。 */
export function symbolCompletionItems(
	entries: WorkspacePath[],
): CompletionItem[] {
	return entries.flatMap((entry) =>
		entry.symbol
			? [
					{
						id: JSON.stringify([
							entry.uri,
							entry.name,
							entry.symbol,
						]),
						label: entry.name,
						description: `${symbolKindName(entry.symbol.kind)} · ${entry.symbol.range.start.line + 1}行 · ${entry.path}`,
						text: `${pathText(entry)} `,
						reference: entry,
					},
				]
			: [],
	);
}

/** 行頭の/・@、任意位置の#をカーソル直前から検出する。 */
export function $completion(): Completion | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return null;
	}
	const block = selection.anchor.getNode().getTopLevelElement();
	if (!block || block instanceof PastedBlockNode) {
		return null;
	}
	const end = $pointOffset(selection.anchor, block);
	const before = block.getTextContent().slice(0, end);
	const match = /(?:^|\n)([/@])([^\s#/@]*)$|(#)([^\s#]*)$/.exec(before);
	if (!match) {
		return null;
	}
	const marker = match[1] ?? match[3]!;
	const query = match[2] ?? match[4]!;
	return {
		key: block.getKey(),
		start: end - query.length - 1,
		end,
		marker,
		query,
	};
}

/** トリガーと検索文字だけを置き換え、カーソル後方の本文を残す。 */
export function $insertCompletion(
	match: Completion,
	text: string,
	reference?: ComposerTarget,
): void {
	const block = $getNodeByKey(match.key);
	if (!$isElementNode(block)) {
		return;
	}
	$selectOffset(block, match.end);
	const end = $getSelection();
	if (!$isRangeSelection(end)) {
		return;
	}
	const point = {
		key: end.anchor.key,
		offset: end.anchor.offset,
		type: end.anchor.type,
	};
	$selectOffset(block, match.start);
	const range = $getSelection();
	if (!$isRangeSelection(range)) {
		return;
	}
	range.focus.set(point.key, point.offset, point.type);
	if (reference) {
		$addUpdateTag(HISTORY_PUSH_TAG);
		const space = $createTextNode(" ");
		range.insertNodes([$createPathReferenceNode(reference), space]);
		space.selectEnd();
	} else {
		range.insertText(text);
	}
}

/** スラッシュ・スキル・コンテキストの候補を検索語で絞る。 */
export function completionItems(
	marker: string,
	category: string,
	query: string,
	attachments: Attachment[],
	skills: SkillSummary[],
): CompletionItem[] {
	let items: CompletionItem[];
	if (marker === "/") {
		items = [
			{
				id: "new",
				label: "/new",
				description: "新しい会話を開始",
				text: "/new ",
			},
		];
	} else if (marker === "@") {
		items = skills.map((skill) => ({
			id: skill.path,
			label: skill.name,
			description: skill.description,
			text: `@${skill.name} `,
		}));
	} else if (!category) {
		items = [
			"添付ファイル",
			"ファイルとディレクトリ",
			"シンボル",
			"セッション",
			"Changes",
		].map((label) => ({ id: label, label, category: label }));
	} else if (category === "Changes") {
		items = (Object.keys(changeScopes) as ChangeScope[]).map((scope) => {
			const { name, description } = changeScopes[scope];
			const reference: ChangeReference = { kind: "changes", scope, name };
			return {
				id: scope,
				label: name,
				description,
				reference,
				text: `${pathText(reference)} `,
			};
		});
	} else if (category === "添付ファイル") {
		items = attachments.map((file) => ({
			id: file.id,
			label: file.name,
			description: file.uri,
			text: `${file.uri} `,
			reference: {
				uri: file.uri,
				name: file.name,
				path: file.uri,
				kind: "file",
			},
		}));
	} else {
		items = [];
	}
	return items.filter((item) =>
		`${item.label} ${item.description ?? ""}`
			.toLocaleLowerCase()
			.includes(query.toLocaleLowerCase()),
	);
}
