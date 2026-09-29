// カテゴリに応じた候補の取得と、添付済みファイルの統合を担当する。
import type { Attachment } from "@nerita/shared/composer";
import type { SkillSummary } from "@nerita/shared/skills";
import type { Bridge } from "@nerita/shared/bridge";
import { completionItems, type CompletionItem } from "./completionItems";
import { useWorkspacePaths } from "./useWorkspacePaths";
import { useWorkspaceSymbols } from "./useWorkspaceSymbols";
import { useSessionReferences } from "./useSessionReferences";

/** ＋と本文補完で同じ取得状態と検索結果を使う。 */
export function useCompletionCandidates({
	bridge,
	marker,
	category,
	query,
	attachments,
	skills,
	collaborationModes,
	canAttach,
}: {
	bridge: Bridge | undefined;
	marker: string | undefined;
	category: string;
	query: string;
	attachments: Attachment[];
	skills: SkillSummary[];
	collaborationModes: boolean | undefined;
	canAttach: boolean;
}) {
	const browsing = marker === "#" && category === "ファイルとディレクトリ";
	const paths = useWorkspacePaths(bridge, browsing, query);
	const searchingSymbols = marker === "#" && category === "シンボル";
	const symbols = useWorkspaceSymbols(bridge, searchingSymbols, query);
	const searchingSessions =
		marker === "#" && ["セッション", "ハンドオフ"].includes(category);
	const sessions = useSessionReferences(
		bridge,
		searchingSessions,
		query,
		category === "ハンドオフ" ? "handoff" : "transcript",
	);
	/** 一覧の状態と案内を、選択中のカテゴリに合わせる。 */
	function candidates(): {
		items: CompletionItem[];
		empty: string;
		notice?: string | undefined;
	} {
		if (browsing) {
			const attached = paths.hasParent
				? []
				: completionItems("#", category, query, attachments, []);
			return {
				items: mergeAttachedPaths(paths.items, attached),
				empty: paths.empty,
			};
		}
		if (searchingSymbols) {
			return symbols;
		}
		if (searchingSessions) {
			return sessions;
		}
		return {
			items: completionItems(
				marker ?? "",
				category,
				query,
				attachments,
				skills,
				collaborationModes,
			).map((item) =>
				item.category === "添付ファイル"
					? { ...item, disabled: !canAttach }
					: item,
			),
			empty: "候補がありません。",
		};
	}
	return { ...candidates(), paths, browsing, sessions };
}

/** ワークスペースに同じ URI がある添付は二重に表示しない。 */
function mergeAttachedPaths(
	paths: CompletionItem[],
	attached: CompletionItem[],
) {
	const uris = new Set(paths.map((item) => referenceUri(item)));
	return [
		...paths,
		...attached.filter((item) => !uris.has(referenceUri(item))),
	];
}

/** ファイル参照だけから URI を取り出す。 */
function referenceUri(item: CompletionItem) {
	return item.reference && "uri" in item.reference
		? item.reference.uri
		: undefined;
}
