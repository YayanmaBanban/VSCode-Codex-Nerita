// 補完候補の生成と絞り込みを、Lexical の選択範囲や編集処理から分離する。
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

/** 選択可能な候補。`category` は次の一覧を開く入口。 */
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

/** スラッシュ・スキル・コンテキストの候補を検索語で絞る。 */
export function completionItems(
	marker: string,
	category: string,
	query: string,
	attachments: Attachment[],
	skills: SkillSummary[],
	collaborationModes = false,
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
			{
				id: "mcp",
				label: "/mcp",
				description: "MCPサーバーの接続状態を表示",
				text: "/mcp ",
			},
			{
				id: "logout",
				label: "/logout",
				description: "Codexからログアウト",
				text: "/logout ",
			},
		];
		if (collaborationModes) {
			items.push(
				{
					id: "plan",
					label: "/plan",
					description: "Plan モードに切り替え",
					text: "/plan ",
				},
				{
					id: "goal",
					label: "/goal",
					description: "Goal モードに切り替え",
					text: "/goal ",
				},
			);
		}
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
			"変更点",
		].map((label) => ({ id: label, label, category: label }));
	} else if (category === "変更点") {
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
