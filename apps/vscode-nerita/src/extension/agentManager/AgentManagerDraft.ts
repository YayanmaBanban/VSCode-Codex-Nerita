// 下書きは設定とは別の固定ファイルへ保存し、世代競合があっても編集内容を退避できるようにする。
import {
	managerDraftSchema,
	type ManagerDraft,
} from "@nerita/shared/agentManager/draft";
import {
	readWorkspaceFile,
	serialized,
	writeWorkspaceFile,
} from "./WorkspaceFiles";

/** ワークスペース外へのリンクと過大なファイルを通常の設定と同じ経路で拒否する。 */
export async function readManagerDraft(root: string, backend: "pi" | "codex") {
	const text = await readWorkspaceFile(
		root,
		`.nerita/agent-manager-draft-${backend}.json`,
		1048576,
	);
	if (text === undefined) {
		return null;
	}
	const draft = managerDraftSchema.nullable().parse(JSON.parse(text));
	if (draft !== null && draft.backend !== backend) {
		throw new Error("下書きのバックエンドが一致しません。");
	}
	return draft;
}
/** 世代に依存せず退避するが、書き込み権限とファイルの同時更新は保存直前にも照合する。 */
export function writeManagerDraft(
	root: string,
	backend: "pi" | "codex",
	draft: ManagerDraft | null,
	assertWritable: () => void,
) {
	return serialized(root, async () => {
		const value = managerDraftSchema.nullable().parse(draft);
		if (value !== null && value.backend !== backend) {
			throw new Error("下書きのバックエンドが一致しません。");
		}
		assertWritable();
		const file = `.nerita/agent-manager-draft-${backend}.json`;
		const previous = await readWorkspaceFile(root, file, 1048576);
		assertWritable();
		await writeWorkspaceFile(
			root,
			file,
			previous,
			`${JSON.stringify(value, null, 2)}\n`,
			1048576,
		);
	});
}
