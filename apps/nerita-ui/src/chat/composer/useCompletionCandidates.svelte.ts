// 現在のカテゴリーを getter で参照し、非同期に取得した別のカテゴリーの候補を混ぜない。
type CandidateInput = {
	bridge: Bridge | undefined;
	marker: string | undefined;
	category: string;
	query: string;
	attachments: Attachment[];
	skills: SkillSummary[];
	collaborationModes: boolean | undefined;
	canAttach: boolean;
};
import type { Attachment } from "@nerita/shared/composer";
import type { SkillSummary } from "@nerita/shared/skills";
import type { Bridge } from "@nerita/shared/bridge";
import { completionItems, type CompletionItem } from "./completionItems";
import { useWorkspacePaths } from "./useWorkspacePaths.svelte";
import { useWorkspaceSymbols } from "./useWorkspaceSymbols.svelte";
import { useSessionReferences } from "./useSessionReferences.svelte";

/** 候補をカテゴリーごとに読み込み、選択された一覧だけを公開する。 */
export function useCompletionCandidates(input: CandidateInput) {
	const browsing = $derived(
		input.marker === "#" && input.category === "ファイルとディレクトリ",
	);
	const paths = useWorkspacePaths({
		get bridge() {
			return input.bridge;
		},
		get active() {
			return browsing;
		},
		get query() {
			return input.query;
		},
	});
	const symbols = useWorkspaceSymbols({
		get bridge() {
			return input.bridge;
		},
		get active() {
			return input.marker === "#" && input.category === "シンボル";
		},
		get query() {
			return input.query;
		},
	});
	const sessions = useSessionReferences({
		get bridge() {
			return input.bridge;
		},
		get active() {
			return (
				input.marker === "#" &&
				["セッション", "ハンドオフ"].includes(input.category)
			);
		},
		get query() {
			return input.query;
		},
		get mode() {
			return input.category === "ハンドオフ" ? "handoff" : "transcript";
		},
	});
	const current = $derived(
		currentCandidates(input, paths, symbols, sessions, browsing),
	);
	return {
		paths,
		sessions,
		get browsing() {
			return browsing;
		},
		get loading() {
			const searchingSymbols =
				input.marker === "#" && input.category === "シンボル";
			return searchingSymbols && symbols.loading;
		},
		get items() {
			return current.items;
		},
		get empty() {
			return current.empty;
		},
		get notice() {
			return current.notice;
		},
	};
}

/** ファイル参照だけを重複排除の対象にする。 */
function referenceUri(item: CompletionItem) {
	return item.reference && "uri" in item.reference
		? item.reference.uri
		: undefined;
}

/** 選択された一覧だけを公開し、添付と同一の URI を二重に表示しない。 */
function currentCandidates(
	input: CandidateInput,
	paths: ReturnType<typeof useWorkspacePaths>,
	symbols: ReturnType<typeof useWorkspaceSymbols>,
	sessions: ReturnType<typeof useSessionReferences>,
	browsing: boolean,
) {
	if (browsing) {
		const attached = paths.hasParent
			? []
			: completionItems(
					"#",
					input.category,
					input.query,
					input.attachments,
					[],
				);
		const uris = paths.items.map(referenceUri);
		return {
			items: [
				...paths.items,
				...attached.filter(
					(item) => !uris.includes(referenceUri(item)),
				),
			],
			empty: paths.empty,
			notice: undefined,
		};
	}
	if (input.marker === "#" && input.category === "シンボル") {
		return {
			items: symbols.items,
			empty: symbols.empty,
			notice: symbols.notice,
		};
	}
	const searchingSessions =
		input.marker === "#" &&
		["セッション", "ハンドオフ"].includes(input.category);
	if (searchingSessions) {
		return {
			items: sessions.items,
			empty: sessions.empty,
			notice: sessions.notice,
		};
	}
	return {
		items: completionItems(
			input.marker ?? "",
			input.category,
			input.query,
			input.attachments,
			input.skills,
			input.collaborationModes,
		).map((item) =>
			item.category === "添付ファイル"
				? { ...item, disabled: !input.canAttach }
				: item,
		),
		empty: "候補がありません。",
		notice: undefined,
	};
}
