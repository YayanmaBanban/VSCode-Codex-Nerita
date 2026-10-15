// 階層の移動と Host への遅延読み込みを、候補の編集処理から分離する。
import {
	isNonEmptyString,
	isNonZeroNumber,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";

import type { Bridge } from "@nerita/shared/bridge";

import type {
	WorkspacePath,
	WorkspacePathsResult,
} from "@nerita/shared/workspacePaths";

import type { CompletionItem } from "./completionItems";

import { pathText } from "@nerita/shared/composerReferences";
/** ワークスペース内のパス候補を取得する。Svelte の寿命管理内で呼び出し、接続と検索条件は最新値を参照できるようにする。 */
export function useWorkspacePaths(input: {
	bridge: Bridge | undefined;
	active: boolean;
	query: string;
}) {
	const bridge = $derived(input.bridge);
	const active = $derived(input.active);
	const query = $derived(input.query);

	let stack = $state.raw<WorkspacePath[]>([]);
	/** 閲覧中のディレクトリ階層を、直接値または前の階層からの更新で保持する。 */
	const setStack = (
		value: typeof stack | ((previous: typeof stack) => typeof stack),
	) => {
		stack = typeof value === "function" ? value(stack) : value;
	};
	let result = $state.raw<{
		uri: string | null;
		data: WorkspacePathsResult;
	} | null>(null);
	/** 取得元のディレクトリに結び付いたパス候補を、直接値または更新処理で保持する。 */
	const setResult = (
		value: typeof result | ((previous: typeof result) => typeof result),
	) => {
		result = typeof value === "function" ? value(result) : value;
	};
	const current = $derived(stack.at(-1));
	const uri = $derived(current?.uri ?? null);
	// 表示する階層が変わると Host へ取得を要求し、旧階層の応答購読を解除する。
	$effect(() => {
		setResult(null);
		if (!active || !bridge) {
			return;
		}
		const requestedUri = uri;
		const requestId = crypto.randomUUID();
		const unsubscribe = bridge.subscribe((message) => {
			const matchesType =
				message.type === "workspace/paths" &&
				message.requestId === requestId;
			if (matchesType) {
				setResult({ uri: requestedUri, data: message });
			}
		});
		bridge.postMessage({ type: "workspace/listPaths", requestId, uri });
		return unsubscribe;
	});
	const data = $derived(result?.uri === uri ? result.data : null);
	const filtered = $derived(workspaceCompletionItems(data, query, current));
	return {
		get ancestors() {
			return stack;
		},
		goTo: (depth: number) =>
			setStack((previous) => previous.slice(0, depth)),
		get items() {
			return filtered;
		},
		get path() {
			return current?.path ?? "ワークスペース";
		},
		get empty() {
			return emptyPathMessage(bridge, data, uri);
		},
		open: (entry: WorkspacePath) =>
			setStack((previous) => [...previous, entry]),
		back: () => setStack((previous) => previous.slice(0, -1)),
		reset: () => setStack([]),
		get hasParent() {
			return stack.length > 0;
		},
	};
}

/** 取得した階層から検索語に一致する候補を作る。 */
function workspaceCompletionItems(
	data: WorkspacePathsResult | null,
	query: string,
	current: WorkspacePath | undefined,
) {
	const items: CompletionItem[] =
		data?.entries.map((entry) => ({
			id: entry.uri,
			label: entry.name + (entry.kind === "directory" ? "/" : ""),
			description: entry.path,
			...(entry.kind === "directory"
				? { directory: entry }
				: { text: `${pathText(entry)} `, reference: entry }),
		})) ?? [];
	const filtered = items.filter((item) =>
		item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
	);
	const loadedPaths = current && data && !isNonEmptyString(data.error);
	if (loadedPaths === true && query.trim() === "") {
		filtered.unshift({
			id: "insert-directory",
			label: "このフォルダのパスを挿入",
			description: current.path,
			text: `${pathText(current)} `,
			reference: current,
		});
	}
	return filtered;
}

/** 接続・取得状態とフォルダの有無から候補がない理由を返す。 */
function emptyPathMessage(
	bridge: Bridge | undefined,
	data: WorkspacePathsResult | null,
	uri: string | null,
) {
	if (!bridge) {
		return "ファイル選択を利用できません。";
	}
	if (!data) {
		return "読み込み中…";
	}
	const workspacePresent =
		isNonEmptyString(uri) || isNonZeroNumber(data.entries.length);
	return (
		nonEmptyString(data.error) ??
		(workspacePresent
			? "候補がありません。"
			: "開いているワークスペースがありません。")
	);
}
