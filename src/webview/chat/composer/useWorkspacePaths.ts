// 階層の移動とHostへの遅延読み込みを、候補の編集処理から分離する。
import { useEffect, useState } from "react";
import type { Bridge } from "../../vscodeBridge";
import type {
	WorkspacePath,
	WorkspacePathsResult,
} from "../../../shared/workspacePaths";
import type { CompletionItem } from "./completions";
import { pathText } from "../../../shared/composerReferences";

/** 開いている階層だけを読み、閉じたメニューや旧要求への応答を捨てる。 */
export function useWorkspacePaths(
	bridge: Bridge | undefined,
	active: boolean,
	query: string,
) {
	const [stack, setStack] = useState<WorkspacePath[]>([]);
	const [result, setResult] = useState<{
		uri: string | null;
		data: WorkspacePathsResult;
	} | null>(null);
	const current = stack.at(-1);
	const uri = current?.uri ?? null;
	useEffect(() => {
		setResult(null);
		if (!active || !bridge) {
			return;
		}
		const requestId = crypto.randomUUID();
		const unsubscribe = bridge.subscribe((message) => {
			if (
				message.type === "workspace/paths" &&
				message.requestId === requestId
			) {
				setResult({ uri, data: message });
			}
		});
		bridge.postMessage({ type: "workspace/listPaths", requestId, uri });
		return unsubscribe;
	}, [active, bridge, uri]);
	const data = result?.uri === uri ? result.data : null;
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
	if (current && data && !data.error && !query.trim()) {
		filtered.unshift({
			id: "insert-directory",
			label: "このフォルダのパスを挿入",
			description: current.path,
			text: `${pathText(current)} `,
			reference: current,
		});
	}
	return {
		items: filtered,
		path: current?.path ?? "ワークスペース",
		empty: !bridge
			? "ファイル選択を利用できません。"
			: !data
				? "読み込み中…"
				: data.error ||
					(uri || data.entries.length
						? "候補がありません。"
						: "開いているワークスペースがありません。"),
		open: (entry: WorkspacePath) =>
			setStack((previous) => [...previous, entry]),
		back: () => setStack((previous) => previous.slice(0, -1)),
		reset: () => setStack([]),
		hasParent: stack.length > 0,
	};
}
